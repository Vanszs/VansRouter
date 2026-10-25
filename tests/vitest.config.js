import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
    // Don't scan nested agent/git worktrees — they carry their own copies of
    // tests but lack the root dependency context.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/.kilo/**", "**/.git/**", "**/dist/**", "**/all-endpoints-robust.test.js"],
    maxConcurrency: 10,
    testTimeout: 15000,
    // Hooks re-import modules (vi.resetModules + dynamic import) and some suites
    // spawn real child processes; the 10s default is not enough under 10-way
    // parallelism, which showed up as flaky hook timeouts in xai-oauth-service
    // and spawn races in devin-cli-executor.
    hookTimeout: 30000,
    pool: "threads",
    // Suppress noisy console output from handlers under test
    silent: false,
    env: {
      API_KEY_SECRET: "test-api-key-secret-for-ci-only",
    },
  },
  // Next.js compiles JSX in .js files through SWC; esbuild's default loader
  // treats .js as plain JS and refuses to parse component sources. Tests that
  // render a client component need this to import it.
  esbuild: {
    loader: "jsx",
    jsx: "automatic",
    include: /[\\/]src[\\/].*\.js$/,
    exclude: /node_modules/,
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
