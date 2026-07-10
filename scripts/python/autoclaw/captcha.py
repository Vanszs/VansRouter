"""
Shumei slider captcha solver — NCC template matching with human-like mouse trace.
Ported from src/lib/oauth/utils/captchaSolver.js.
No external deps beyond Playwright.
"""

import asyncio
import base64
import math
import random
import time
from dataclasses import dataclass, field


SHUMEI_SELECTORS = {
    "wrapper": ".shumei_captcha_wrapper",
    "bg": ".shumei_captcha_loaded_img_bg",
    "fg": ".shumei_captcha_loaded_img_fg",
    "slider": ".shumei_captcha_slide_btn",
    "slide_wrapper": ".shumei_captcha_slide_wrapper",
}

SHUMEI_ICON_SELECTORS = {
    "wrapper": ".shumei_captcha_wrapper.mode-icon_select",
    "bg": ".shumei_captcha_loaded_img_bg",
    "fg": ".icon_select_img",
    "tips": ".shumei_captcha_slide_tips",
}

ICON_COUNT = 4
ICON_MATCH_SIZE = 75  # resize template to this size before matching
ICON_ROTATE_STEP = 6  # rotation step in degrees
ICON_MIN_THRESHOLD = 0.35  # min correlation score to accept match
ICON_MIN_OVERLAP = 0.15  # minimum overlap region to exclude from subsequent matches

CAPTCHA_WAIT_TIMEOUT = 15_000
PRE_DRAG_DELAY_MS = 1200
FINAL_HOLD_MS = 900


@dataclass
class TraceResult:
    trace: list[list[float]]  # [[x, y_offset, t_ms], ...]
    total_time: int


async def _download_image(page, selector: str, label: str) -> str:
    """Download captcha image as base64 data URL via Playwright's request context (bypasses CORS)."""
    src = await page.locator(selector).get_attribute("src")
    if not src:
        raise ValueError(f"No src found for {selector}")

    resp = await page.request.get(src)
    if not resp.ok:
        raise RuntimeError(f"Download {label} failed: HTTP {resp.status}")

    buf = await resp.body()
    mime = resp.headers.get("content-type", "image/png")
    return f"data:{mime};base64,{base64.b64encode(buf).decode()}"


async def _wait_for_images(page) -> None:
    """Wait until captcha bg/fg images are fully loaded in DOM."""
    await page.wait_for_function(
        """() => {
            const bg = document.querySelector('.shumei_captcha_loaded_img_bg');
            const fg = document.querySelector('.shumei_captcha_loaded_img_fg');
            return bg && fg && bg.complete && fg.complete && bg.naturalWidth > 0 && fg.naturalWidth > 0;
        }""",
        timeout=10_000,
    )


async def compute_distance(page) -> dict | None:
    """NCC template matching. Returns {bestX, bgW, bgH} or None."""
    import time as _time

    await _wait_for_images(page)

    bg_data_url, fg_data_url = await asyncio.gather(
        _download_image(page, SHUMEI_SELECTORS["bg"], "bg"),
        _download_image(page, SHUMEI_SELECTORS["fg"], "fg"),
    )

    t0 = _time.monotonic()

    result = await page.evaluate(
        """async ({bgSrc, fgSrc}) => {
            function loadImage(src) {
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = src;
                });
            }

            const [bgImg, fgImg] = await Promise.all([loadImage(bgSrc), loadImage(fgSrc)]);

            const bgC = document.createElement('canvas');
            bgC.width = bgImg.naturalWidth; bgC.height = bgImg.naturalHeight;
            const bgCtx = bgC.getContext('2d');
            bgCtx.drawImage(bgImg, 0, 0);
            const bgPixels = bgCtx.getImageData(0, 0, bgC.width, bgC.height).data;

            const fgC = document.createElement('canvas');
            fgC.width = fgImg.naturalWidth; fgC.height = fgImg.naturalHeight;
            const fgCtx = fgC.getContext('2d');
            fgCtx.drawImage(fgImg, 0, 0);
            const fgPixels = fgCtx.getImageData(0, 0, fgC.width, fgC.height).data;

            const bw = bgC.width, bh = bgC.height;
            const tw = fgC.width, th = fgC.height;

            // BG grayscale
            const bgGray = new Float64Array(bw * bh);
            for (let i = 0; i < bw * bh; i++) {
                const p = i * 4;
                bgGray[i] = 0.299 * bgPixels[p] + 0.587 * bgPixels[p + 1] + 0.114 * bgPixels[p + 2];
            }

            // FG masked pixels (alpha > 10)
            const fgPixels = [];
            let fgSum = 0;
            for (let i = 0; i < tw * th; i++) {
                const p = i * 4;
                const a = fgPixels[p + 3];
                if (a < 11) continue;
                const gray = (0.299 * fgPixels[p] + 0.587 * fgPixels[p + 1] + 0.114 * fgPixels[p + 2]) * (a / 255);
                fgPixels.push({ row: Math.floor(i / tw), col: i % tw, gray, diff: 0 });
                fgSum += gray;
            }
            const fgCount = fgPixels.length;
            if (fgCount === 0) return { bestX: 0, bgW: bw, bgH: bh };
            const fgMean = fgSum / fgCount;

            let fgVar = 0;
            for (const px of fgPixels) {
                const d = px.gray - fgMean;
                px.diff = d;
                fgVar += d * d;
            }

            const yEnd = Math.max(0, bh - th);
            const yStart = Math.min(Math.max(0, Math.floor(bh * 0.15)), yEnd);
            let bestVal = -Infinity, bestX = 0;
            const stride = 2;

            function scoreAt(sx, sy) {
                let sum = 0, bgWinVar = 0;
                for (const px of fgPixels) {
                    const bgVal = bgGray[(sy + px.row) * bw + (sx + px.col)];
                    sum += px.diff * bgVal;
                    bgWinVar += bgVal * bgVal;
                }
                const denom = Math.sqrt(fgVar * bgWinVar);
                return denom > 1e-10 ? sum / denom : -Infinity;
            }

            for (let sy = yStart; sy <= yEnd; sy++) {
                for (let sx = 0; sx <= bw - tw; sx += stride) {
                    const val = scoreAt(sx, sy);
                    if (val > bestVal) { bestVal = val; bestX = sx; }
                }
            }

            // Refine stride 1
            const refStart = Math.max(0, bestX - stride);
            const refEnd = Math.min(bw - tw, bestX + stride);
            for (let sy = yStart; sy <= yEnd; sy++) {
                for (let sx = refStart; sx <= refEnd; sx++) {
                    const val = scoreAt(sx, sy);
                    if (val > bestVal) { bestVal = val; bestX = sx; }
                }
            }

            // Prefer rightmost candidate with similar score
            const coverStart = Math.max(0, bestX - 4);
            const coverEnd = Math.min(bw - tw, bestX + 24);
            let coverX = bestX;
            for (let sx = coverStart; sx <= coverEnd; sx++) {
                const val = scoreAt(sx, yStart);
                if (val >= bestVal - 0.01) coverX = sx;
            }

            return { bestX: coverX, rawBestX: bestX, bgW: bw, bgH: bh };
        }""",
        {"bgSrc": bg_data_url, "fgSrc": fg_data_url},
    )

    elapsed = (_time.monotonic() - t0) * 1000
    if not result or result["bestX"] <= 0:
        print(f"[Captcha] NCC returned {result.get('bestX') if result else None} ({elapsed:.0f}ms) — no match")
        return None

    print(f"[Captcha] NCC bestX={result['bestX']} bg={result['bgW']}x{result['bgH']} ({elapsed:.0f}ms)")
    return result


def get_trace(distance: float, backtrack: bool = True) -> TraceResult:
    """Generate human-like mouse trace with acceleration curve and Y jitter."""
    start_time = int(time.time() * 1000)
    back = (2 + random.randint(0, 4)) if backtrack else 0
    total_dist = distance + back

    tracks: list[int] = []
    current = 0.0
    v = 0.0

    while current < total_dist - 13:
        a = 10000 + random.randint(0, 2000)
        v0 = v
        t = 9 + random.randint(0, 9)
        s = v0 * t / 1000 + 0.5 * a * (t / 1000) ** 2
        current += s
        v = v0 + a * t / 1000
        if current < total_dist:
            tracks.append(round(current))

    last = tracks[-1] if tracks else 0
    for i in range(last + 1, int(total_dist) + 1):
        tracks.append(i)

    if backtrack:
        for _ in range(back):
            current -= 1
            tracks.append(round(current))
        tracks.append(round(current) - 1)
        if tracks and tracks[-1] != total_dist - back:
            tracks.append(int(total_dist - back))

    timestamps: list[int] = []
    ts = start_time
    for _ in tracks:
        ts += 11 + random.randint(0, 7)
        timestamps.append(ts)

    y_jitter_pool = [0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, 0, 0]
    y_offsets: list[int] = []
    zy = 0
    for i in range(len(tracks)):
        zy += y_jitter_pool[i % len(y_jitter_pool)]
        y_offsets.append(zy)

    trace = [[float(tracks[i]), float(y_offsets[i]), float(timestamps[i] - start_time)] for i in range(len(tracks))]
    total_time = int(trace[-1][2] + 1 + random.randint(0, 4)) if trace else 0

    return TraceResult(trace=trace, total_time=total_time)


async def drag_slider(page, distance: float, original_width: int) -> bool:
    """Drag captcha slider to computed NCC position with human-like timing."""
    slider = page.locator(SHUMEI_SELECTORS["slider"])
    wrapper = page.locator(SHUMEI_SELECTORS["slide_wrapper"])
    bg_img = page.locator(SHUMEI_SELECTORS["bg"])

    slider_box = await slider.bounding_box()
    wrapper_box = await wrapper.bounding_box()
    img_box = await bg_img.bounding_box()

    if not slider_box or not wrapper_box or not img_box:
        print("[Captcha] Slider or wrapper not visible")
        return False

    start_x = slider_box["x"] + slider_box["width"] / 2
    start_y = slider_box["y"] + slider_box["height"] / 2
    track_width = wrapper_box["width"] - slider_box["width"]
    image_scale = img_box["width"] / original_width
    target_distance = min(track_width, distance * image_scale)

    print(f"[Captcha] slider=({slider_box['x']:.0f},{slider_box['y']:.0f}) "
          f"track={track_width:.0f}px scale={image_scale:.3f} target={target_distance:.0f}px")

    trace_result = get_trace(target_distance, backtrack=False)
    pages_before = len(page.context.pages)

    await asyncio.sleep(PRE_DRAG_DELAY_MS / 1000)
    await page.mouse.move(start_x, start_y)
    await page.mouse.down()

    for i, (x, y_offset, t) in enumerate(trace_result.trace):
        delay = max(0.005, (t - trace_result.trace[i - 1][2]) / 1000) if i > 0 else t / 1000
        await page.mouse.move(start_x + x, start_y + y_offset, steps=1)
        await asyncio.sleep(min(delay, 0.03))

    await page.mouse.move(start_x + target_distance, start_y, steps=3)

    try:
        await page.wait_for_function(
            f"""target => {{
                const btn = document.querySelector('.shumei_captcha_slide_btn');
                if (!btn) return false;
                return Math.abs(btn.offsetLeft - target) <= 2;
            }}""",
            round(target_distance),
            timeout=1000,
        )
    except Exception:
        pass

    await asyncio.sleep(FINAL_HOLD_MS / 1000)
    await page.mouse.up()

    # Verify: captcha gone or popup opened
    deadline = time.time() + 8
    while time.time() < deadline:
        if len(page.context.pages) > pages_before:
            print("[Captcha] Solved — new popup opened")
            return True
        gone = await page.evaluate(
            """() => {
                const w = document.querySelector('.shumei_captcha_wrapper');
                return !w || w.style.display === 'none' || w.style.visibility === 'hidden';
            }"""
        )
        if gone:
            print("[Captcha] Solved — wrapper gone")
            return True
        await asyncio.sleep(0.25)

    print("[Captcha] Verification timeout")
    return False


async def solve_shumei_captcha(page, timeout: int = CAPTCHA_WAIT_TIMEOUT) -> bool:
    """Detect and solve the Shumei captcha (slider or icon-select variant)."""
    print("[Captcha] Starting solve")

    try:
        await page.wait_for_selector(SHUMEI_SELECTORS["wrapper"], timeout=timeout)
        print("[Captcha] Wrapper found")
    except Exception:
        print("[Captcha] Wrapper not found within timeout")
        return False

    await asyncio.sleep(0.5)

    # Check if icon-select variant is present
    icon_tips = await page.query_selector(SHUMEI_ICON_SELECTORS["wrapper"])
    if icon_tips:
        print("[Captcha] Icon-select variant detected")
        return await _solve_icon_select(page)

    result = await compute_distance(page)
    if not result or result["bestX"] <= 0:
        print(f"[Captcha] Distance invalid: {result}")
        return False

    return await drag_slider(page, result["bestX"], result["bgW"])


async def _solve_icon_select(page) -> bool:
    """Solve Shumei icon-selection captcha: extract red icons from fg row,
    template-match them against bg image, click matched positions in order."""
    import numpy as np
    import cv2

    print("[Captcha-Icon] Downloading images")

    try:
        bg_data_url, fg_data_url = await asyncio.gather(
            _download_image(page, SHUMEI_ICON_SELECTORS["bg"], "icon_bg"),
            _download_image(page, SHUMEI_ICON_SELECTORS["fg"], "icon_fg"),
        )
    except Exception as e:
        print(f"[Captcha-Icon] Image download failed: {e}")
        # Dump relevant DOM for debugging
        try:
            html = await page.evaluate(
                """() => {
                    const w = document.querySelector('.shumei_captcha_wrapper');
                    if (!w) return 'NO_WRAPPER';
                    const imgs = w.querySelectorAll('img');
                    return Array.from(imgs).map(i => ({
                        className: i.className,
                        src: (i.src || '').slice(0, 120),
                        naturalWidth: i.naturalWidth,
                        complete: i.complete
                    }));
                }"""
            )
            print(f"[Captcha-Icon] DOM dump: {html}")
        except Exception:
            pass
        return False

    bg_box = await page.locator(SHUMEI_ICON_SELECTORS["bg"]).bounding_box()
    if not bg_box:
        print("[Captcha-Icon] BG image bounding box missing")
        return False

    def _url_to_cv2(data_url: str):
        """Convert base64 data URL to BGR numpy array via cv2."""
        header, b64 = data_url.split(",", 1)
        buf = base64.b64decode(b64)
        arr = np.frombuffer(buf, np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)

    def _extract_red(img: np.ndarray) -> np.ndarray:
        """Keep only red-ish pixels (HSV mask), return black-background image."""
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        lower1 = np.array([0, 120, 70])
        upper1 = np.array([10, 255, 255])
        lower2 = np.array([170, 120, 70])
        upper2 = np.array([180, 255, 255])
        mask = cv2.inRange(hsv, lower1, upper1) | cv2.inRange(hsv, lower2, upper2)
        result = np.zeros_like(img)
        result[mask > 0] = img[mask > 0]
        return result

    def _rotate(template: np.ndarray, angle: float) -> np.ndarray:
        h, w = template.shape[:2]
        m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        return cv2.warpAffine(template, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)

    def _match(template: np.ndarray, scene: np.ndarray) -> tuple[float, tuple[int, int]]:
        tg = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
        sg = cv2.cvtColor(scene, cv2.COLOR_BGR2GRAY)
        res = cv2.matchTemplate(sg, tg, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(res)
        return max_val, max_loc

    t_start = time.time()

    bg_cv = _url_to_cv2(bg_data_url)
    fg_cv = _url_to_cv2(fg_data_url)

    bg_red = _extract_red(bg_cv)
    fg_red = _extract_red(fg_cv)

    bg_h, bg_w = bg_cv.shape[:2]
    fg_h, fg_w = fg_cv.shape[:2]

    # FG image is a horizontal strip: ICON_COUNT icons side by side.
    # Each icon column is fg_w // ICON_COUNT pixels wide, full height.
    col_w = fg_w // ICON_COUNT
    if col_w < 8 or fg_h < 8:
        print(f"[Captcha-Icon] FG image too small: {fg_w}x{fg_h}")
        return False

    print(f"[Captcha-Icon] FG={fg_w}x{fg_h} bg={bg_w}x{bg_h} colW={col_w}")

    matches: list[tuple[tuple[int, int], int]] = []  # [(x_center, y_center), overlap_radius]

    for idx in range(ICON_COUNT):
        x_start = idx * col_w
        x_end = (idx + 1) * col_w if idx < ICON_COUNT - 1 else fg_w
        tile = fg_red[0:fg_h, x_start:x_end]
        if tile.size == 0:
            print(f"[Captcha-Icon] Tile {idx} empty")
            continue

        tile_resized = cv2.resize(tile, (ICON_MATCH_SIZE, ICON_MATCH_SIZE))

        best_angle, best_val, best_loc = 0, -1.0, (0, 0)
        for angle in range(-180, 180, ICON_ROTATE_STEP):
            rotated = _rotate(tile_resized, float(angle))
            val, loc = _match(rotated, bg_red)
            if val > best_val:
                best_val, best_loc, best_angle = val, loc, angle

        print(f"[Captcha-Icon] Tile {idx} bestVal={best_val:.3f} angle={best_angle}")

        if best_val < ICON_MIN_THRESHOLD:
            print(f"[Captcha-Icon] Tile {idx} below threshold {ICON_MIN_THRESHOLD}")
            return False

        cx = best_loc[0] + ICON_MATCH_SIZE // 2
        cy = best_loc[1] + ICON_MATCH_SIZE // 2

        overlap_radius = int(ICON_MATCH_SIZE * ICON_MIN_OVERLAP)
        matches.append(((cx, cy), overlap_radius))
        print(f"[Captcha-Icon] Tile {idx} matched at ({cx},{cy})")

    if len(matches) < 2:
        print(f"[Captcha-Icon] Only {len(matches)} matches found")
        return False

    # Click each match position on the rendered bg img element
    scale_x = bg_box["width"] / bg_w
    scale_y = bg_box["height"] / bg_h

    pages_before = len(page.context.pages)

    for i, ((px, py), _) in enumerate(matches):
        click_x = bg_box["x"] + px * scale_x
        click_y = bg_box["y"] + py * scale_y
        print(f"[Captcha-Icon] Click {i + 1}: img({px},{py}) → page({click_x:.0f},{click_y:.0f})")
        await page.mouse.click(click_x, click_y)
        await asyncio.sleep(0.15 + random.random() * 0.25)

    elapsed = (time.time() - t_start) * 1000
    print(f"[Captcha-Icon] Solve complete ({elapsed:.0f}ms)")

    # Verify: captcha gone or new popup opened
    deadline = time.time() + 8
    while time.time() < deadline:
        if len(page.context.pages) > pages_before:
            print("[Captcha-Icon] Solved — new popup opened")
            return True
        gone = await page.evaluate(
            """() => {
                const w = document.querySelector('.shumei_captcha_wrapper');
                return !w || w.style.display === 'none' || w.style.visibility === 'hidden';
            }"""
        )
        if gone:
            print("[Captcha-Icon] Solved — wrapper gone")
            return True
        await asyncio.sleep(0.25)

    print("[Captcha-Icon] Verification timeout")
    return False
