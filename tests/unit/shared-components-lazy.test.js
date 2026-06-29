import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Heavy modals in src/shared/components/index.js are exported via
 * next/dynamic with `ssr: false`. This means they can only be used inside
 * Client Components. If a Server Component accidentally imports one and
 * uses it in JSX, the build fails with "ssr: false is not allowed with
 * next/dynamic in Server Components".
 *
 * Importing the barrel transitively pulls in JSX files (Button, etc.),
 * which vitest in node env cannot parse without extra config. Instead,
 * we inspect the source to assert the barrel shape is what production
 * depends on.
 */
const barrelSource = fs.readFileSync(
  path.resolve("src/shared/components/index.js"),
  "utf8",
);

describe("shared/components barrel (lazy modal exports)", () => {
  it('starts with "use client"', () => {
    expect(barrelSource).toMatch(/^["']use client["']/);
  });

  it("imports next/dynamic and defines a lazyModal helper", () => {
    expect(barrelSource).toMatch(/import\s+dynamic\s+from\s+["']next\/dynamic["']/);
    expect(barrelSource).toMatch(/const\s+lazyModal\s*=/);
  });

  it("uses { ssr: false } so the modal only loads on the client", () => {
    expect(barrelSource).toMatch(/ssr:\s*false/);
    expect(barrelSource).toMatch(/loading:\s*\(\)\s*=>\s*null/);
  });

  const expectedLazy = [
    "OAuthModal",
    "ModelSelectModal",
    "ManualConfigModal",
    "ComboFormModal",
    "McpMarketplaceModal",
    "KiroAuthModal",
    "KiroOAuthWrapper",
    "KiroSocialOAuthModal",
    "CursorAuthModal",
    "IFlowCookieModal",
    "GitLabAuthModal",
    "EditConnectionModal",
    "AddCustomEmbeddingModal",
    "NoAuthProxyCard",
    "ChangelogModal",
    "ProviderInfoCard",
  ];

  for (const name of expectedLazy) {
    it(`exports ${name} via the lazy loader (not as default)`, () => {
      const re = new RegExp(
        `export\\s+const\\s+${name}\\s*=\\s*lazyModal`,
      );
      expect(barrelSource, `${name} must be a lazyModal export`).toMatch(re);
    });
  }

  const expectedEager = [
    "Button",
    "Input",
    "Select",
    "Card",
    "Modal",
    "ConfirmModal",
    "Badge",
    "Toggle",
    "ThemeToggle",
    "Sidebar",
    "Header",
    "Footer",
    "UsageStats",
    "LanguageSwitcher",
    "NineRemoteButton",
    "HeaderMenu",
    "RequestLogger",
    "SegmentedControl",
    "Tooltip",
    "CapacityBadges",
    "ThemeProvider",
  ];

  for (const name of expectedEager) {
    it(`keeps ${name} as an eager export (default-re-export or named)`, () => {
      // Accept `export { default as X } from "./X"`, `export { X } from "./X"`,
      // or `export { default as Y, X } from "./Z"` (mixed re-exports).
      const reDefault = new RegExp(
        `export\\s*\\{\\s*default\\s+as\\s+${name}\\b`,
      );
      const reNamedStandalone = new RegExp(
        `export\\s*\\{\\s*${name}\\s*\\}\\s*from`,
      );
      const reMixedList = new RegExp(
        `export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`,
      );
      const ok =
        reDefault.test(barrelSource) ||
        reNamedStandalone.test(barrelSource) ||
        reMixedList.test(barrelSource);
      expect(ok, `${name} must remain an eager export`).toBe(true);
    });
  }
});
