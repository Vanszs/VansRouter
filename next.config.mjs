import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const projectRoot = dirname(fileURLToPath(import.meta.url));
// CLI bundling needs workspace root so tracing includes hoisted node_modules (slim ~50MB).
// Docker / default uses projectRoot so server.js lands at /app/server.js (not nested).
const tracingRoot = process.env.NEXT_TRACING_ROOT_MODE === "workspace"
  ? join(projectRoot, "..")
  : projectRoot;
const proxyClientMaxBodySize = process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE || "128mb";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite"],
  turbopack: {
    root: tracingRoot
  },
  outputFileTracingRoot: tracingRoot,
  outputFileTracingExcludes: {
    "*": ["./gitbook/**/*", "./.git/**/*", "./tests/**/*", "./docs/**/*", "./.fakehome/**/*"]
  },
  // Disable Next.js built-in gzip/br compression so SSE chunks are flushed
  // immediately to the client instead of being batched by the compressor.
  // Express/nginx handles compression at the edge if needed.
  compress: false,
  images: {
    unoptimized: true
  },
  env: {},
  experimental: {
    // #1529/#1572: LLM clients can send long context or base64 image payloads through /v1 rewrites.
    proxyClientMaxBodySize,
    // Cache fetch responses across HMR refreshes for faster dev reloads.
    serverComponentsHmrCache: true,
  },
  webpack: (config, { isServer }) => {
    // Ignore fs/path modules in browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    // Mark bun: and node:sqlite as ignored — they're runtime-only,
    // webpack can't bundle them. serverExternalPackages handles named packages
    // but dynamic `import("bun:sqlite")` / `import("node:sqlite")` still leak
    // into the client graph. IgnorePlugin via createRequire (webpack is
    // transitive dep via next, not a direct dep we can ESM-import).
    // NOTE: only ignore bun:sqlite and node:sqlite — NOT node:fs/node:path
    // which ARE needed server-side by next/standalone.
    const require = createRequire(import.meta.url);
    const webpack = require("webpack");
    config.plugins = [...(config.plugins || []),
      new webpack.IgnorePlugin({
        resourceRegExp: /^(bun:sqlite|node:sqlite)$/,
      }),
    ];
    // Exclude non-source dirs from watcher to reduce inotify load
    config.watchOptions = {
      ...config.watchOptions,
      aggregateTimeout: 300,
      ignored: /[\\/](node_modules|\.git|logs|\.next|\.next-cli-build|gitbook|cli|open-sse\.old|tests|docs)[\\/]/,
    };
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1/v1",
        destination: "/api/v1"
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses"
      },
      {
        source: "/responses",
        destination: "/api/v1/responses"
      },
      {
        source: "/v1beta/:path*",
        destination: "/api/v1beta/:path*"
      },
      {
        source: "/v1beta",
        destination: "/api/v1beta"
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  },
  async headers() {
    return [
      {
        // Provider icons (webp), favicons, logos — immutable, hash-stable files.
        // Browser caches for 1 year; revalidation via Last-Modified/ETag.
        source: "/providers/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Next.js hashed static assets (JS/CSS chunks) — content-addressed, safe to cache forever.
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  }
};

export default nextConfig;
