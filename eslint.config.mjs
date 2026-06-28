import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Server-side modules (API routes, open-sse engine, lib) are plain Node ESM
  // with no JSX — enable no-undef there to catch use-before-define /
  // undefined-identifier bugs (ReferenceError at runtime) that
  // eslint-config-next does not flag by default. Scoped away from React/JSX
  // component files where no-undef produces false positives on props/params.
  {
    files: [
      "src/app/api/**/*.js",
      "open-sse/**/*.js",
      "src/lib/**/*.js",
      "src/sse/**/*.js",
      "cli/**/*.js",
    ],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
  // Dashboard client components: also enable no-undef to catch runtime crashes
  // like `onClick={handleBatchDelete}` where the handler was renamed/deleted but
  // a JSX call site was missed (GitHub Issue #1) and CLI tool cards passing
  // undefined props to inner section components.
  {
    files: ["src/app/(dashboard)/**/*.js"],
    rules: {
      "no-undef": "error",
    },
  },
  // Service Worker script uses the `clients` global.
  {
    files: ["cli/app/public/sw.js"],
    languageOptions: {
      globals: {
        clients: "readonly",
      },
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CLI shipped/bundled artifacts and dependencies (lint the source, not output):
    "cli/node_modules/**",
    "cli/app/.next/**",
    "cli/app/.next-cli-build/**",
    "cli/app/src/mitm/server.js",
  ]),
]);

export default eslintConfig;
