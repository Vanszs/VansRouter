import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
    // Excluded: these target code/deps not present in this fork and fail at
    // import time (not logic failures):
    //   - embeddings.cloud.test.js → imports cloud/src/handlers/embeddings.js
    //     (the Cloudflare Workers "cloud" package is a separate deployment, not
    //     vendored in this repo).
    //   - db-benchmark.test.js → an A/B perf benchmark (not a correctness test)
    //     that requires the optional `lowdb` package; the app uses SQLite and
    //     does not declare lowdb as a dependency.
    exclude: [
      "**/node_modules/**",
      "**/embeddings.cloud.test.js",
      "**/db-benchmark.test.js",
    ],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
