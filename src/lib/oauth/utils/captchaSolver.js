/**
 * Shumei slide captcha solver — canvas-based template matching
 * Runs NCC in-browser via page.evaluate(). No extra deps.
 *
 * Usage:
 *   import { solveShumeiCaptcha } from './captchaSolver.js';
 *   await solveShumeiCaptcha(page);
 */

const SHUMEI_SELECTORS = {
  wrapper: '.shumei_captcha_wrapper',
  bg: '.shumei_captcha_loaded_img_bg',
  fg: '.shumei_captcha_loaded_img_fg',
  slider: '.shumei_captcha_slide_btn',
  slideWrapper: '.shumei_captcha_slide_wrapper',
};

export const CAPTCHA_WAIT_TIMEOUT = 15_000;
const DETECT_POLL_MS = 300;

const LOG_PFX = "[CaptchaSolver]";
const SHUMEI_PRE_DRAG_DELAY_MS = 1200;
const SHUMEI_FINAL_HOLD_MS = 900;
function log(...args) { console.log(LOG_PFX, ...args); }
function warn(...args) { console.warn(LOG_PFX, ...args); }

/**
 * Wait until shumei captcha appears on the page
 */
export async function waitForCaptcha(page, timeoutMs = CAPTCHA_WAIT_TIMEOUT) {
  log("waitForCaptcha — waiting for .shumei_captcha_wrapper");
  try {
    await page.waitForSelector(SHUMEI_SELECTORS.wrapper, { timeout: timeoutMs });
    log("waitForCaptcha — found");
    return true;
  } catch {
    warn("waitForCaptcha — not found within", timeoutMs, "ms");
    return false;
  }
}

/**
 * Wait for the captcha images to actually finish loading in the browser
 * before trying to download them via Node.js.
 */
async function waitForImagesReady(page) {
  log("waitForImagesReady — waiting for img.complete + naturalWidth > 0");
  const ok = await page.waitForFunction(() => {
    const bg = document.querySelector('.shumei_captcha_loaded_img_bg');
    const fg = document.querySelector('.shumei_captcha_loaded_img_fg');
    return bg && fg && bg.complete && fg.complete && bg.naturalWidth > 0 && fg.naturalWidth > 0;
  }, { timeout: 10_000 }).then(() => true).catch(() => {
    warn("waitForImagesReady — timeout, images may not be ready");
    return false;
  });
  if (ok) {
    const sizes = await page.evaluate(() => {
      const bg = document.querySelector('.shumei_captcha_loaded_img_bg');
      const fg = document.querySelector('.shumei_captcha_loaded_img_fg');
      return { bg: `${bg?.naturalWidth}x${bg?.naturalHeight}`, fg: `${fg?.naturalWidth}x${fg?.naturalHeight}` };
    });
    log(`waitForImagesReady — bg=${sizes.bg} fg=${sizes.fg}`);
  }
  await new Promise(r => setTimeout(r, 500));
}

/**
 * Download an image URL from the page into a base64 data URL via Node.js
 * (bypasses CORS — the browser can't read cross-origin canvas pixels).
 * Retries once with delay for slow CDN.
 */
async function imageUrlToDataUrl(page, imgSelector, label) {
  const src = await page.locator(imgSelector).getAttribute("src");
  if (!src) {
    warn(`imageUrlToDataUrl(${label}) — no src attribute`);
    throw new Error(`No src found for ${imgSelector}`);
  }
  log(`imageUrlToDataUrl(${label}) — downloading ${src.slice(0, 100)}...`);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const t0 = Date.now();
      const resp = await fetch(src);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const mime = resp.headers.get("content-type") || "image/png";
      const elapsed = Date.now() - t0;
      log(`imageUrlToDataUrl(${label}) — done ${(buf.length / 1024).toFixed(0)}KB in ${elapsed}ms (${mime})`);
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch (err) {
      warn(`imageUrlToDataUrl(${label}) — attempt ${attempt} failed: ${err.message}`);
      if (attempt === 1) throw err;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

/**
 * NCC template matching — runs entirely in-page with data URLs (no CORS taint).
 */
export async function computeDistance(page) {
  await waitForImagesReady(page);

  const [bgDataUrl, fgDataUrl] = await Promise.all([
    imageUrlToDataUrl(page, SHUMEI_SELECTORS.bg, "bg"),
    imageUrlToDataUrl(page, SHUMEI_SELECTORS.fg, "fg"),
  ]);

  log("computeDistance — starting NCC matching in-page");
  const t0 = Date.now();

  // Diagnostic: check image data before NCC
  const diag = await page.evaluate(({ bgSrc, fgSrc }) => {
    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }
    return Promise.all([loadImage(bgSrc), loadImage(fgSrc)]).then(([bgImg, fgImg]) => {
      const bgC = document.createElement('canvas'), fgC = document.createElement('canvas');
      bgC.width = bgImg.naturalWidth; bgC.height = bgImg.naturalHeight;
      fgC.width = fgImg.naturalWidth; fgC.height = fgImg.naturalHeight;
      const bgCtx = bgC.getContext('2d'), fgCtx = fgC.getContext('2d');
      bgCtx.drawImage(bgImg, 0, 0); fgCtx.drawImage(fgImg, 0, 0);
      const bgPx = bgCtx.getImageData(0, 0, bgC.width, bgC.height).data;
      const fgPx = fgCtx.getImageData(0, 0, fgC.width, fgC.height).data;
      let opaque = 0, total = fgC.width * fgC.height, minA = 255, maxA = 0;
      for (let i = 0; i < total; i++) {
        const a = fgPx[i * 4 + 3];
        if (a >= 128) opaque++;
        if (a < minA) minA = a;
        if (a > maxA) maxA = a;
      }
      // Sample some BG pixel values
      let bgSamples = [];
      for (let i = 0; i < 5; i++) {
        const idx = Math.floor(Math.random() * (bgC.width * bgC.height)) * 4;
        bgSamples.push({ r: bgPx[idx], g: bgPx[idx+1], b: bgPx[idx+2] });
      }
      const bgTotal = bgC.width * bgC.height;
      return {
        fgSize: `${fgC.width}x${fgC.height}`,
        bgSize: `${bgC.width}x${bgC.height}`,
        fgPixels: total, fgOpaque: opaque, fgTransparent: total - opaque,
        fgAlphaRange: `${minA}-${maxA}`,
        bgSamples,
        bgHasData: bgTotal > 0 && bgPx[3] > 0,
      };
    });
  }, { bgSrc: bgDataUrl, fgSrc: fgDataUrl });

  log("computeDistance — diag:", JSON.stringify(diag));

  const nccResult = await page.evaluate(({ bgSrc, fgSrc }) => {
    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }

    return Promise.all([loadImage(bgSrc), loadImage(fgSrc)]).then(([bgImg, fgImg]) => {
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = bgImg.naturalWidth;
      bgCanvas.height = bgImg.naturalHeight;
      const bgCtx = bgCanvas.getContext('2d');
      bgCtx.drawImage(bgImg, 0, 0);
      const bgPixels = bgCtx.getImageData(0, 0, bgCanvas.width, bgCanvas.height).data;

      const fgCanvas = document.createElement('canvas');
      fgCanvas.width = fgImg.naturalWidth;
      fgCanvas.height = fgImg.naturalHeight;
      const fgCtx = fgCanvas.getContext('2d');
      fgCtx.drawImage(fgImg, 0, 0);
      const fgPixels = fgCtx.getImageData(0, 0, fgCanvas.width, fgCanvas.height).data;

      const bw = bgCanvas.width, bh = bgCanvas.height;
      const tw = fgCanvas.width, th = fgCanvas.height;

      // BG grayscale (ignore alpha)
      const bgGray = new Float64Array(bw * bh);
      for (let i = 0; i < bw * bh; i++) {
        const p = i * 4;
        bgGray[i] = 0.299 * bgPixels[p] + 0.587 * bgPixels[p + 1] + 0.114 * bgPixels[p + 2];
      }

      // FG: masked NCC — only iterate over non-transparent pixels
      // Use alpha > 10 threshold to include anti-aliased edge pixels
      const fgPixels_ = [];
      let fgSum = 0;
      for (let i = 0; i < tw * th; i++) {
        const p = i * 4;
        const a = fgPixels[p + 3];
        if (a < 11) continue;
        const gray = (0.299 * fgPixels[p] + 0.587 * fgPixels[p + 1] + 0.114 * fgPixels[p + 2]) * (a / 255);
        const row = Math.floor(i / tw);
        const col = i % tw;
        fgPixels_.push({ row, col, gray, alpha: a });
        fgSum += gray;
      }
      const fgCount = fgPixels_.length;
      if (fgCount === 0) return { bestX: 0, bgW: bw, bgH: bh };
      const fgMean = fgSum / fgCount;

      let fgVar = 0;
      for (const px of fgPixels_) {
        const d = px.gray - fgMean;
        px.diff = d;
        fgVar += d * d;
      }

      const yEnd = Math.max(0, bh - th);
      const yStart = Math.min(Math.max(0, Math.floor(bh * 0.15)), yEnd);
      let bestVal = -1 / 0, bestX = 0;
      const stride = 2;

      function scoreAt(sx, sy) {
        let sum = 0, bgWinVar = 0;
        for (const px of fgPixels_) {
          const bgVal = bgGray[(sy + px.row) * bw + (sx + px.col)];
          sum += px.diff * bgVal;
          bgWinVar += bgVal * bgVal;
        }
        const denom = Math.sqrt(fgVar * bgWinVar);
        return denom > 1e-10 ? sum / denom : -1 / 0;
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

      // If scores are nearly tied, prefer the rightmost local candidate so the
      // visual puzzle fully covers the gap instead of stopping just short.
      const coverStart = Math.max(0, bestX - 4);
      const coverEnd = Math.min(bw - tw, bestX + 24);
      let coverX = bestX;
      for (let sx = coverStart; sx <= coverEnd; sx++) {
        const val = scoreAt(sx, yStart);
        if (val >= bestVal - 0.01) coverX = sx;
      }

      return { bestX: coverX, rawBestX: bestX, bgW: bw, bgH: bh };
    });
  }, { bgSrc: bgDataUrl, fgSrc: fgDataUrl });

  const elapsed = Date.now() - t0;
  if (!nccResult || nccResult.bestX <= 0) {
    warn(`computeDistance — NCC returned ${nccResult?.bestX} (${elapsed}ms) — no match found`);
    return null;
  }
  log(`computeDistance — NCC rawBestX=${nccResult.rawBestX ?? nccResult.bestX}, coverX=${nccResult.bestX} (bg=${nccResult.bgW}x${nccResult.bgH}) (${elapsed}ms)`);
  return nccResult;
}

/**
 * Generate human-like mouse trace
 * Ported from shumei_captcha image_match.py
 */
export function getTrace(distance, { backtrack = true } = {}) {
  const startTime = Date.now();
  const back = backtrack ? 2 + Math.floor(Math.random() * 5) : 0;
  const totalDist = distance + back;

  const tracks = [];
  let current = 0;
  let v = 0;

  // Acceleration phase
  while (current < totalDist - 13) {
    const a = 10000 + Math.floor(Math.random() * 2001);
    const v0 = v;
    const t = 9 + Math.floor(Math.random() * 10);
    const s = v0 * t / 1000 + 0.5 * a * (t / 1000) ** 2;
    current += s;
    v = v0 + a * t / 1000;
    if (current < totalDist) {
      tracks.push(Math.round(current));
    }
  }

  // Fill remaining
  const lastTrack = tracks.length > 0 ? tracks[tracks.length - 1] : 0;
  for (let i = lastTrack + 1; i <= totalDist; i++) {
    tracks.push(i);
  }

  if (backtrack) {
    // Overshoot correction
    for (let i = 0; i < back; i++) {
      current -= 1;
      tracks.push(Math.round(current));
    }

    tracks.push(Math.round(current) - 1);

    if (tracks[tracks.length - 1] !== totalDist - back) {
      tracks.push(totalDist - back);
    }
  }

  // Generate timestamps
  const timestamps = [];
  let ts = startTime;
  for (let i = 0; i < tracks.length; i++) {
    ts += 11 + Math.floor(Math.random() * 8);
    timestamps.push(ts);
  }

  // Generate Y jitter
  const yOffsets = [];
  let zy = 0;
  const yJitterPool = [0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, 0, 0];
  for (let i = 0; i < tracks.length; i++) {
    zy += yJitterPool[i % yJitterPool.length];
    yOffsets.push(zy);
  }

  const trace = tracks.map((x, i) => [x, yOffsets[i], timestamps[i] - startTime]);
  const totalTime = trace[trace.length - 1]?.[2] ?? 0;

  return { trace, totalTime: totalTime + 1 + Math.floor(Math.random() * 5) };
}

/**
 * Drag the captcha slider to the computed position
 */
export async function dragSlider(page, distance, originalWidth) {
  const sliderBtn = page.locator(SHUMEI_SELECTORS.slider);
  const wrapper = page.locator(SHUMEI_SELECTORS.slideWrapper);

  const sliderBox = await sliderBtn.boundingBox();
  const wrapperBox = await wrapper.boundingBox();
  if (!sliderBox || !wrapperBox) {
    warn(`dragSlider — slider or wrapper not visible`);
    return false;
  }

  const startX = sliderBox.x + sliderBox.width / 2;
  const startY = sliderBox.y + sliderBox.height / 2;
  const trackWidth = wrapperBox.width - sliderBox.width;

  const img = page.locator(SHUMEI_SELECTORS.bg);
  const imgBox = await img.boundingBox();
  if (!imgBox) {
    warn(`dragSlider — bg img not visible`);
    return false;
  }

  // NCC distance is in original image pixel space. Shumei moves the puzzle in
  // rendered image space, not handle-max track space, then clamps by track max.
  const imageScale = imgBox.width / originalWidth;
  const targetDistance = Math.min(trackWidth, distance * imageScale);

  log(`dragSlider — slider at (${sliderBox.x.toFixed(0)}, ${sliderBox.y.toFixed(0)}) ${sliderBox.width.toFixed(1)}x${sliderBox.height.toFixed(1)}`);
  log(`dragSlider — track ${trackWidth.toFixed(0)}px (wrapper ${wrapperBox.width.toFixed(0)} - btn ${sliderBox.width.toFixed(0)}), bgDisplay=${imgBox.width.toFixed(0)}px`);
  log(`dragSlider — NCC=${distance}, origW=${originalWidth}, imageScale=${imageScale.toFixed(3)}, target=${targetDistance.toFixed(0)}px`);

  const { trace } = getTrace(targetDistance, { backtrack: false });
  log(`dragSlider — trace ${trace.length} points, last X=${trace[trace.length-1][0].toFixed(0)}`);
  const pageCountBeforeDrag = page.context().pages().length;

  log(`dragSlider — pre-drag delay ${SHUMEI_PRE_DRAG_DELAY_MS}ms`);
  await new Promise(r => setTimeout(r, SHUMEI_PRE_DRAG_DELAY_MS));

  // Use page.mouse (trusted browser events) with human timing
  // Shumei ignores synthetic dispatchEvent (isTrusted=false)
  // Try page.mouse first, then fallback to in-page dispatch if slider didn't move
  await page.mouse.move(startX, startY);

  // Ensure slider element actually receives mousedown — some captchas need
  // the event on the exact element
  const sliderReady = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const btn = document.querySelector('.shumei_captcha_slide_btn');
    return { hitEl: el?.className?.slice(0, 80) || el?.tagName || 'none', isSlider: el === btn || btn?.contains(el) };
  }, { x: startX, y: startY });
  log("dragSlider — element under cursor:", JSON.stringify(sliderReady));

  await page.mouse.down();

  for (let i = 0; i < trace.length; i++) {
    const [x, yOffset, t] = trace[i];
    const delay = i > 0 ? Math.max(5, t - trace[i - 1][2]) : t;
    await page.mouse.move(startX + x, startY + yOffset, { steps: 1 });
    await new Promise(r => setTimeout(r, Math.min(delay, 30)));
  }

  await page.mouse.move(startX + targetDistance, startY, { steps: 3 });

  // Wait until UI catches up before release; releasing early leaves a visible gap.
  await page.waitForFunction((target) => {
    const btn = document.querySelector('.shumei_captcha_slide_btn');
    if (!btn) return false;
    return Math.abs(btn.offsetLeft - target) <= 2;
  }, Math.round(targetDistance), { timeout: 1000 }).catch(() => null);

  log(`dragSlider — final hold ${SHUMEI_FINAL_HOLD_MS}ms before release`);
  await new Promise(r => setTimeout(r, SHUMEI_FINAL_HOLD_MS));

  await page.mouse.up();

  // Diagnostic: check if slider moved
  const postDrag = await page.evaluate(() => {
    const btn = document.querySelector('.shumei_captcha_slide_btn');
    if (!btn) return null;
    return { left: btn.style.left, transform: btn.style.transform, offsetLeft: btn.offsetLeft };
  });
  log("dragSlider — post-drag state:", JSON.stringify(postDrag));

  log("dragSlider — drag done, waiting for captcha verification");
  const verifyDeadline = Date.now() + 8_000;
  while (Date.now() < verifyDeadline) {
    if (page.context().pages().length > pageCountBeforeDrag) {
      log("dragSlider — captcha solved, new popup opened");
      return true;
    }
    const gone = await page.evaluate(() => {
      const wrapper = document.querySelector('.shumei_captcha_wrapper');
      return !wrapper || wrapper.style.display === 'none' || wrapper.style.visibility === 'hidden';
    }).catch(() => true);
    if (gone) {
      log("dragSlider — captcha solved, wrapper gone");
      return true;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  warn("dragSlider — verification timeout, captcha may not have accepted");
  return false;
}

/**
 * Solve Shumei captcha — detect, compute, drag
 */
export async function solveShumeiCaptcha(page, { timeout = CAPTCHA_WAIT_TIMEOUT } = {}) {
  log("solveShumeiCaptcha — starting");
  const found = await waitForCaptcha(page, timeout);
  if (!found) {
    warn("solveShumeiCaptcha — captcha wrapper not found");
    return false;
  }

  await new Promise(r => setTimeout(r, 500));

  log("solveShumeiCaptcha — computing distance");
  const result = await computeDistance(page);
  if (!result || !result.bestX || result.bestX <= 0) {
    warn("solveShumeiCaptcha — distance invalid:", result?.bestX);
    return false;
  }

  log("solveShumeiCaptcha — dragging slider");
  const ok = await dragSlider(page, result.bestX, result.bgW);
  log(`solveShumeiCaptcha — ${ok ? "SUCCESS" : "FAILED"}`);
  return ok;
}

export default solveShumeiCaptcha;
