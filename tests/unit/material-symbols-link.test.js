import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * MaterialSymbolsLink is a client-only React component that injects a
 * <link> via document.head.appendChild inside useEffect. Without jsdom we
 * cannot render it, so we verify the source-level invariants instead:
 *   - it is a client component (no SSR fallback)
 *   - it points at the Google Fonts CDN (not the removed npm package)
 *   - it dedupes existing links before appending
 *
 * These invariants are what production behaviour depends on.
 */
describe("MaterialSymbolsLink source invariants", () => {
  const filePath = path.resolve("src/shared/components/MaterialSymbolsLink.js");
  const source = fs.readFileSync(filePath, "utf8");

  it("is a Client Component (\"use client\" directive)", () => {
    expect(source).toMatch(/["']use client["']/);
  });

  it("loads the font from Google Fonts CDN", () => {
    expect(source).toMatch(
      /https:\/\/fonts\.googleapis\.com\/css2\?[^"']*Material\+Symbols\+Outlined/,
    );
  });

  it("does NOT import the removed material-symbols npm package", () => {
    expect(source).not.toMatch(/from\s+["']material-symbols/);
    expect(source).not.toMatch(/require\(["']material-symbols/);
  });

  it("injects the link via useEffect + document.head.appendChild", () => {
    expect(source).toMatch(/useEffect/);
    expect(source).toMatch(/document\.head\.appendChild/);
  });

  it("dedupes by checking for an existing link before injecting", () => {
    expect(source).toMatch(/querySelector\(["']link\[data-material-symbols\][\"']\)/);
  });

  it("uses a marker data attribute to identify its injected link", () => {
    expect(source).toMatch(/data-material-symbols/);
  });
});
