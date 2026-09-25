#!/usr/bin/env node
// Regenerates the self-hosted Material Symbols Outlined subset.
//
// Why: the upstream package ships the full icon font (~3.96 MB). The app only
// renders a couple hundred of the ~4200 glyphs, and font-display:block on that
// payload delayed first paint by ~20s on slow connections. Google's Fonts API
// can emit a subset for an explicit icon list, so we scan the source for every
// icon name that can reach a `material-symbols-outlined` span and self-host the
// result.
//
// Two sources are scanned because both appear in this codebase:
//   1. JSX text children:  <span className="material-symbols-outlined">computer</span>
//   2. string literals:    icon="expand_more" / {open ? "expand_less" : "expand_more"}
//
// src/ additionally contributes every bare word that matches an official icon
// name. That is deliberately wider than the two patterns above: an extra icon
// costs roughly 150 bytes in the subset, while a missing one renders as raw text
// in the UI (which is exactly how expand_more, expand_less and computer broke).
// open-sse/ only contributes quoted literals (provider registry display icons).
//
// Names are validated against Google's icon metadata. The npm package's
// index.d.ts is NOT authoritative here: it is missing names the font really has
// (for example expand_more and expand_less).
//
// Run after adding or renaming icons:  node scripts/subset-material-symbols.cjs
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const metadataCache = path.join(root, "node_modules", ".cache", "material-symbols-metadata.json");
const nameListFile = path.join(root, "node_modules", "material-symbols", "index.d.ts");
const outDir = path.join(root, "src", "app", "fonts");
const outFile = path.join(outDir, "material-symbols-outlined-subset.woff2");
const manifestFile = path.join(outDir, "material-symbols-icons.json");
const wideRoots = ["src"];
const literalRoots = ["src", "open-sse"];
// The app pins opsz 24, wght 400, GRAD 0 and only toggles FILL between 0 and 1
// (see .material-symbols-outlined / .fill-1 in globals.css), so request exactly
// those axes. A narrower axis set keeps the subset small.
const apiBase =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0&icon_names=";
const METADATA_URL = "https://fonts.google.com/metadata/icons?incomplete=true&key=material_symbols";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function sourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(entryPath));
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

// Candidate icon names, unfiltered. JSX children are unambiguous (they follow
// the icon class); wide roots also yield bare words; literal roots yield quoted
// strings. Callers filter by the official name list.
function collectIconCandidates(dirs = { wide: wideRoots, literal: literalRoots }) {
  const jsxChildren = new Set();
  const words = new Set();
  const literals = new Set();
  for (const dir of new Set([...dirs.wide, ...dirs.literal])) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</g)) {
        jsxChildren.add(match[1]);
      }
      if (dirs.wide.includes(dir)) {
        for (const match of text.matchAll(/\b([a-z][a-z0-9_]{2,})\b/g)) words.add(match[1]);
      }
      if (dirs.literal.includes(dir)) {
        for (const match of text.matchAll(/"([a-z0-9_]+)"|'([a-z0-9_]+)'/g)) {
          literals.add(match[1] || match[2]);
        }
      }
    }
  }
  return {
    jsxChildren: [...jsxChildren].sort(),
    words: [...words].sort(),
    literals: [...literals].sort(),
  };
}

function collectIconNames(officialNames, dirs) {
  const { jsxChildren, words, literals } = collectIconCandidates(dirs);
  const used = new Set();
  for (const name of jsxChildren) if (officialNames.has(name)) used.add(name);
  for (const name of words) if (officialNames.has(name)) used.add(name);
  for (const name of literals) if (officialNames.has(name)) used.add(name);
  return [...used].sort();
}

async function officialIconNames() {
  try {
    const response = await fetch(METADATA_URL, { headers: { "User-Agent": UA } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.text()).replace(/^\)\]\}'\s*/, "");
    const names = (JSON.parse(body).icons || []).map((icon) => icon.name).filter(Boolean);
    if (!names.length) throw new Error("empty icon list");
    fs.mkdirSync(path.dirname(metadataCache), { recursive: true });
    fs.writeFileSync(metadataCache, JSON.stringify({ fetchedAt: new Date().toISOString(), names }));
    return new Set(names);
  } catch (error) {
    if (fs.existsSync(metadataCache)) {
      console.warn(`metadata fetch failed (${error.message}), using cache`);
      return new Set(JSON.parse(fs.readFileSync(metadataCache, "utf8")).names);
    }
    if (fs.existsSync(nameListFile)) {
      console.warn(`metadata fetch failed (${error.message}), falling back to package index.d.ts`);
      const source = fs.readFileSync(nameListFile, "utf8");
      return new Set([...source.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]));
    }
    throw error;
  }
}

async function main() {
  const official = await officialIconNames();
  const names = collectIconNames(official);
  if (!names.length) throw new Error("no icon names found in src/");
  console.log(`icons: ${names.length} of ${official.size} known names`);

  const response = await fetch(apiBase + names.join(","), { headers: { "User-Agent": UA } });
  if (!response.ok) {
    throw new Error(`Google Fonts returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const css = await response.text();
  const fontUrl = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
  if (!fontUrl) throw new Error(`no font url in Google Fonts response: ${css.slice(0, 300)}`);

  const font = Buffer.from(await (await fetch(fontUrl)).arrayBuffer());
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, font);
  fs.writeFileSync(
    manifestFile,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), count: names.length, names }, null, 2)}\n`,
  );
  console.log(`wrote ${path.relative(root, outFile)} (${(font.length / 1024).toFixed(1)} KiB)`);
  console.log(`wrote ${path.relative(root, manifestFile)} (${names.length} names)`);
}

module.exports = { collectIconCandidates, collectIconNames, officialIconNames, literalRoots, wideRoots };

if (require.main === module) {
  main().catch((error) => {
    console.error(`subset-material-symbols failed: ${error.message}`);
    process.exitCode = 1;
  });
}
