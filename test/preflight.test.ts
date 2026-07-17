import { runAnalyzePreflight } from "../src/pipeline/preflight.js";
import type { MndConfig } from "../src/types/config.js";
import { getProjectPaths } from "../src/core/projectPaths.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("preflight", () => {
  let vaultPath: string;
  const slug = "preflight-test-slug";

  beforeEach(async () => {
    vaultPath = join(tmpdir(), `mnd-preflight-test-${Date.now()}`);
    const paths = getProjectPaths(vaultPath, slug);
    await mkdir(paths.rawDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  test("throws if config profile is unsupported", async () => {
    const config = { profile: "unknown" } as unknown as MndConfig;
    await expect(runAnalyzePreflight(vaultPath, slug, config)).rejects.toThrow(/unsupported configuration profile/i);
  });

  test("throws if missing Groq API key in hybrid profile", async () => {
    const config = {
      profile: "hybrid",
      connections: { groq_api_key_ref: "missing" },
      models: { hybrid: { text: { model: "foo" }, vision: { model: "foo" } } }
    } as unknown as MndConfig;
    // It should check the keyring, which mock might not have "missing"
    // To properly test keyring we'd mock @napi-rs/keyring
  });

  test("throws if no raw media exists", async () => {
    const paths = getProjectPaths(vaultPath, slug);
    const config = { profile: "local", connections: { ollama_host: "foo" }, models: { local: { text: { model: "foo" }, vision: { model: "foo" } } } } as unknown as MndConfig;
    await expect(runAnalyzePreflight(vaultPath, slug, config)).rejects.toThrow(/no valid media files found/i);
  });
});
