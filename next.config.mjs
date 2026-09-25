import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
  // Keep `open` external: it derives its own directory from import.meta.url.
  // Bundling it rewrites that URL to the build machine's path and breaks
  // Windows/macOS OAuth flows at module load time.
  serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "open", "dompurify", "chalk"],
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
    // Tree-shake heavy barrel imports to cut compile + bundle size
    optimizePackageImports: ["@xyflow/react", "@dnd-kit/core", "@dnd-kit/sortable", "material-symbols", "marked"],
  },
  webpack: (config, { isServer, webpack }) => {
    // Ignore fs/path modules in browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    if (isServer) {
      // These are runtime built-ins, not npm packages. Keep the imports intact
      // even when building under a runtime that does not provide both modules.
      config.externals = [
        { "bun:sqlite": "commonjs bun:sqlite", "node:sqlite": "commonjs node:sqlite" },
        ...(Array.isArray(config.externals) ? config.externals : config.externals ? [config.externals] : []),
      ];
    } else {
      config.plugins = [...(config.plugins || []), new webpack.IgnorePlugin({
        resourceRegExp: /^(bun:sqlite|node:sqlite)$/,
      })];
    }
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
        // Provider icon URLs are stable names, not content hashes. Bound the
        // cache so replacing an icon does not require a year-long purge.
        source: "/providers/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
      {
        // Authenticated HTML must never enter a shared/CDN cache.
        source: "/dashboard/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        source: "/masuk",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        // Keep the public landing document short-lived because it references
        // release-specific hashed chunks.
        source: "/landing",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, s-maxage=300, stale-while-revalidate=3600" },
        ],
      },
      {
        source: "/i18n/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=3600" },
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
