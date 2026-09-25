#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function resolvePackageDir(pkg, searchPaths) {
  for (const base of searchPaths) {
    for (const candidate of [path.join(base, "node_modules", pkg), path.join(base, pkg)]) {
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    }
  }

  try {
    return path.dirname(require.resolve(`${pkg}/package.json`, { paths: searchPaths }));
  } catch {}

  try {
    let directory = path.dirname(require.resolve(pkg, { paths: searchPaths }));
    while (directory !== path.dirname(directory)) {
      if (fs.existsSync(path.join(directory, "package.json"))) return directory;
      directory = path.dirname(directory);
    }
  } catch {}

  return null;
}

function copyPackageClosure(pkg, {
  sourceRoots,
  destinationRoot,
  copyPackage,
  requiredFiles = ["package.json"],
}) {
  const queue = [{ name: pkg, searchPaths: sourceRoots }];
  const seen = new Set();
  const copied = [];

  while (queue.length) {
    const item = queue.shift();
    const name = item.name;
    if (seen.has(name)) continue;
    seen.add(name);

    const source = resolvePackageDir(name, item.searchPaths);
    if (!source) throw new Error(`${name} not found while building a runtime dependency closure`);
    const destination = path.join(destinationRoot, name);
    copyPackage(source, destination);
    if (!fs.existsSync(destination) || !requiredFiles.every((file) => fs.existsSync(path.join(destination, file)))) {
      throw new Error(`${name} was not copied completely into the runtime closure`);
    }
    copied.push(name);

    const manifest = JSON.parse(fs.readFileSync(path.join(destination, "package.json"), "utf8"));
    for (const dependency of Object.keys(manifest.dependencies || {})) {
      const realSource = fs.realpathSync(source);
      queue.push({
        name: dependency,
        searchPaths: [realSource, path.dirname(realSource), ...sourceRoots],
      });
    }
  }

  return copied;
}

function copyDirectory(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
    dereference: true,
  });
}

if (require.main === module) {
  const [pkg, sourceRoot, destinationRoot] = process.argv.slice(2);
  if (!pkg || !sourceRoot || !destinationRoot) {
    throw new Error("Usage: package-closure.cjs <package> <source-root> <destination-root>");
  }
  const copied = copyPackageClosure(pkg, {
    sourceRoots: [sourceRoot],
    destinationRoot,
    copyPackage: copyDirectory,
  });
  console.log(`Copied runtime closure: ${copied.join(", ")}`);
}

module.exports = { copyDirectory, copyPackageClosure, resolvePackageDir };
