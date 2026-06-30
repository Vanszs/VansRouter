#!/usr/bin/env node
/**
 * export-registry.js
 *
 * Serializes the Node.js provider registry into a static JSON file so the
 * Go backend can load it at runtime without importing JavaScript.
 *
 * Run: node scripts/export-registry.js
 * Output: backend/data/providers.json
 */

const { writeFileSync, mkdirSync } = require("node:fs");
const { resolve, dirname } = require("node:path");

const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "backend", "data");
const OUT_FILE = resolve(OUT_DIR, "providers.json");

async function main() {
  const providersModule = await import(
    /* webpackIgnore: true */ resolve(ROOT, "open-sse", "providers", "index.js")
  );
  const registryModule = await import(
    /* webpackIgnore: true */ resolve(ROOT, "open-sse", "providers", "registry", "index.js")
  );

  const { PROVIDERS, PROVIDER_MODELS, PROVIDER_OAUTH, PROVIDER_MEDIA } =
    providersModule;
  const REGISTRY = registryModule.default;

  // Full declarative registry entries keyed by provider id.
  const providers = {};
  for (const entry of REGISTRY) {
    providers[entry.id] = entry;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    providers,
    PROVIDERS,
    PROVIDER_MODELS,
    PROVIDER_OAUTH,
    PROVIDER_MEDIA,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  const providerCount = Object.keys(payload.providers || {}).length;
  const transportCount = Object.keys(payload.PROVIDERS || {}).length;
  const modelGroupCount = Object.keys(payload.PROVIDER_MODELS || {}).length;
  const oauthCount = Object.keys(payload.PROVIDER_OAUTH || {}).length;
  const mediaCount = Object.keys(payload.PROVIDER_MEDIA || {}).length;

  console.log(`Wrote ${OUT_FILE}`);
  console.log(
    `  providers=${providerCount} transports=${transportCount} modelGroups=${modelGroupCount} oauth=${oauthCount} media=${mediaCount}`
  );

  if (providerCount < 100) {
    throw new Error(
      `Expected at least 100 providers, got ${providerCount}. Registry may be incomplete.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
