import { runConfigMigrations, LATEST_CONFIG_VERSION } from "../src/core/migrations.js";
import { join } from "node:path";
import { getAppDataDir } from "../src/core/paths.js";
import { writeFile, readFile, rm } from "node:fs/promises";
import YAML from "yaml";
import { existsSync } from "node:fs";

describe("Config V1 -> V2 Migration", () => {
  const configPath = join(getAppDataDir(), "config.yaml");

  afterEach(async () => {
    if (existsSync(configPath)) {
      await rm(configPath);
    }
  });

  it("should migrate v1 to v2 correctly", async () => {
    const v1Config = {
      version: 1,
      connections: {
        antigravity_cli_path: "C:\\path\\to\\antigravity.exe",
      },
    };
    await writeFile(configPath, YAML.stringify(v1Config), "utf-8");

    await runConfigMigrations();

    const migratedRaw = await readFile(configPath, "utf-8");
    const migrated = YAML.parse(migratedRaw);

    expect(migrated.version).toBe(2);
    expect(migrated.connections.antigravity).toBeDefined();
    expect(migrated.connections.antigravity.discovery_mode).toBe("auto");
    expect(migrated.connections.antigravity.cached_executable_path).toBe("C:\\path\\to\\antigravity.exe");
    expect(migrated.connections.antigravity_cli_path).toBeUndefined();

    expect(migrated.obsidian).toBeDefined();
    expect(migrated.obsidian.initialized).toBe(false);
  });

  it("should handle already v2 configs idempotently", async () => {
    const v2Config = {
      version: 2,
      connections: {
        antigravity: {
          discovery_mode: "manual",
          cached_executable_path: "C:\\path\\to\\antigravity2.exe",
        },
      },
      obsidian: {
        initialized: true,
      }
    };
    await writeFile(configPath, YAML.stringify(v2Config), "utf-8");

    await runConfigMigrations();

    const migratedRaw = await readFile(configPath, "utf-8");
    const migrated = YAML.parse(migratedRaw);

    expect(migrated.version).toBe(2);
    expect(migrated.connections.antigravity.cached_executable_path).toBe("C:\\path\\to\\antigravity2.exe");
  });
});
