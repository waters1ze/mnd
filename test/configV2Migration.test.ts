import { runConfigMigrations, LATEST_CONFIG_VERSION } from "../src/core/migrations.js";
import { join } from "node:path";
import { getAppDataDir } from "../src/core/paths.js";
import { writeFile, readFile, rm } from "node:fs/promises";
import YAML from "yaml";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "mnd-test-config-"));
jest.mock("../src/core/paths.js", () => ({
  getAppDataDir: () => tempDir,
  getTempDir: () => tempDir
}));

describe("Config V1 -> V2 Migration", () => {
  const configPath = join(getAppDataDir(), "config.yaml");

  afterAll(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (existsSync(configPath)) {
      await rm(configPath);
    }
  });

  it("should migrate v1 to v2 correctly", async () => {
    const v1Config = {
      version: 1,
      profile: "hybrid",
      vault_path: "C:\\Vault",
      models: {
        hybrid: { image_gen: {} },
        local: { image_gen: {} }
      },
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
      profile: "hybrid",
      vault_path: "C:\\Vault",
      models: {
        hybrid: { image_gen: {} },
        local: { image_gen: {} }
      },
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

  it("should preserve unknown fields", async () => {
    const v1Config = {
      version: 1,
      profile: "hybrid",
      vault_path: "C:\\Vault",
      some_unknown_field: { keep_me: true },
      models: { hybrid: { image_gen: {} }, local: { image_gen: {} } },
      connections: { antigravity_cli_path: "antigravity" },
    };
    await writeFile(configPath, YAML.stringify(v1Config), "utf-8");
    await runConfigMigrations();
    const migratedRaw = await readFile(configPath, "utf-8");
    const migrated = YAML.parse(migratedRaw);
    expect(migrated.some_unknown_field).toBeDefined();
    expect(migrated.some_unknown_field.keep_me).toBe(true);
    expect(migrated.connections.antigravity.cached_executable_path).toBe("antigravity");
  });

  it("should rollback on verification failure", async () => {
    const v1Config = {
      version: 1,
      profile: "hybrid",
      vault_path: 12345, // invalid type, should trigger schema check failure
      models: { hybrid: { image_gen: {} }, local: { image_gen: {} } },
      connections: { antigravity_cli_path: "antigravity" },
    };
    await writeFile(configPath, YAML.stringify(v1Config), "utf-8");
    await expect(runConfigMigrations()).rejects.toThrow(/Invalid vault_path/);
    const rolledBackRaw = await readFile(configPath, "utf-8");
    const rolledBack = YAML.parse(rolledBackRaw);
    expect(rolledBack.version).toBe(1);
  });

  it("should throw error on malformed config", async () => {
    await writeFile(configPath, "INVALID YAML : [ : {", "utf-8");
    await expect(runConfigMigrations()).rejects.toThrow(/Malformed YAML/);
  });
});
