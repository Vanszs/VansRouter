import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The icon font used to ship as the full ~3.96 MB material-symbols package with
 * font-display:block, which delayed first paint by ~20s on throttled mobile.
 * These tests guard the replacement: a self-hosted subset loaded through
 * next/font/local, with no runtime CDN fetch and no full package stylesheet.
 *
 * The last test is the important one: it fails when a new icon is written as a
 * JSX text child without regenerating the subset (which is how expand_more,
 * expand_less and computer silently broke once).
 */
describe("Material Symbols self-hosted subset", () => {
  const layout = fs.readFileSync(path.resolve("src/app/layout.js"), "utf8");
  const globals = fs.readFileSync(path.resolve("src/app/globals.css"), "utf8");
  const fontFile = path.resolve("src/app/fonts/material-symbols-outlined-subset.woff2");
  const manifestFile = path.resolve("src/app/fonts/material-symbols-icons.json");
  const subsetScript = path.resolve("scripts/subset-material-symbols.cjs");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));

  it("loads the subset through next/font/local", () => {
    expect(layout).toContain('from "next/font/local"');
    expect(layout).toContain("material-symbols-outlined-subset.woff2");
    expect(layout).toContain("--font-material-symbols");
  });

  it("does not import the full package stylesheet or a runtime CDN stylesheet", () => {
    expect(layout).not.toContain("material-symbols/outlined.css");
    expect(layout).not.toMatch(/fonts\.googleapis\.com\/css2\?family=Material\+Symbols/);
  });

  it("wires the icon class to the injected font family", () => {
    expect(globals).toContain("var(--font-material-symbols)");
    expect(globals).toContain(".material-symbols-outlined.fill-1");
  });

  it("ships a subset font far smaller than the full package font", () => {
    const bytes = fs.statSync(fontFile).size;
    expect(bytes).toBeGreaterThan(1000);
    expect(bytes).toBeLessThan(120 * 1024);
    expect(manifest.count).toBe(manifest.names.length);
  });

  it("keeps the regeneration script next to the source scan", () => {
    const script = fs.readFileSync(subsetScript, "utf8");
    expect(script).toContain("fonts.googleapis.com/css2");
    expect(script).toContain("icon_names=");
    expect(script).toContain("material-symbols-icons.json");
  });

  it("includes every icon rendered as a JSX text child", () => {
    const included = new Set(manifest.names);
    const missing = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(entryPath);
        else if (/\.(js|jsx|mjs)$/.test(entry.name)) {
          const text = fs.readFileSync(entryPath, "utf8");
          for (const match of text.matchAll(/material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g)) {
            if (!included.has(match[1])) missing.push(`${match[1]} in ${entryPath}`);
          }
        }
      }
    };
    walk(path.resolve("src"));
    expect(missing).toEqual([]);
  });
});
