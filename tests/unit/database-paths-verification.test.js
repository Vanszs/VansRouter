// Unit tests to ensure database pathing and Docker configurations
// remain bound to "9router" to prevent data loss on VansRouter upgrades.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

describe("Database location & fallback path rules", () => {
  it("dataDir.js must define APP_NAME as '9router'", () => {
    const src = read("src/lib/dataDir.js");
    expect(src).toContain('const APP_NAME = "9router"');
  });

  it("dataDir.js defaultDir must resolve to .9router", () => {
    const src = read("src/lib/dataDir.js");
    expect(src).toContain("~/.${APP_NAME}");
    expect(src).toContain("AppData");
  });

  it("db paths.js resolves to SQLite data file inside DATA_DIR/db/data.sqlite", () => {
    const src = read("src/lib/db/paths.js");
    expect(src).toContain('export const DATA_FILE = path.join(DB_DIR, "data.sqlite")');
    expect(src).toContain('export const DB_DIR = path.join(DATA_DIR, "db")');
  });

  it("docker-compose.yml must preserve the 9router-data volume configuration", () => {
    const composeContent = read("docker-compose.yml");
    const compose = yaml.load(composeContent);

    // Ensure the main service mounts to the volume exactly as '9router-data:/app/data'
    const serviceName = Object.keys(compose.services)[0];
    const service = compose.services[serviceName];
    const hasCorrectVolumeMount = service.volumes.some(
      (v) => v === "9router-data:/app/data"
    );
    
    // Comment explaining failure:
    // If this test fails, it means the Docker volume name '9router-data' was modified.
    // Changing the volume name creates a fresh empty volume, causing a total loss of SQLite data on deployment.
    expect(hasCorrectVolumeMount).toBe(true);

    // Ensure 9router-data volume definition exists in top-level volumes config
    const volumeDef = compose.volumes["9router-data"];
    expect(volumeDef).toBeDefined();
    expect(volumeDef.name).toBe("9router-data");

    expect(service.volumes).toContain("vansrouter-data:/migration-data:ro");
    expect(compose.volumes["vansrouter-data"]).toEqual({ name: "vansrouter-data" });

    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("/migration-data");
    expect(dockerfile).toContain("[ ! -f /app/data/db/.legacy-volume-migrated ]");
    expect(dockerfile).toContain("[ ! -e /app/data/db/data.sqlite ]");
    expect(dockerfile).toContain("[ -d /migration-data ]");
    expect(dockerfile).toContain("copy_missing() {");
    expect(dockerfile).toContain('copy_missing /migration-data /app/data');
    expect(dockerfile).toContain('elif [ ! -e "$destination" ]; then');
    expect(dockerfile).toContain("touch /app/data/db/.legacy-volume-migrated");
  });
});
