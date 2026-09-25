#!/usr/bin/env node
// Default VansRoute production port to 3003 when PORT env is not set.
// The standalone Next.js server otherwise falls back to 3000.
// Use PORT=20127 for `pnpm dev` (development server).
const fs = require('node:fs');
const path = require('node:path');
const { assertProductionSecrets } = require('./runtime-secrets.cjs');

assertProductionSecrets();
process.env.PORT ||= '3003';

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// CURRENT_LINK is the atomic release pointer. Prefer it over a stale
// RELEASE_SERVER left behind by an older PM2 dump.
const currentServer = process.env.CURRENT_LINK
  ? path.join(process.env.CURRENT_LINK, 'server.js')
  : '';
const candidates = currentServer
  ? [currentServer, process.env.RELEASE_SERVER]
  : [process.env.RELEASE_SERVER, path.join(__dirname, '.next', 'standalone', 'server.js')];
const serverPath = candidates.find(isFile);

if (!serverPath) {
  throw new Error(`No standalone server found (checked: ${candidates.join(', ')})`);
}

require(serverPath);
