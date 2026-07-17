// test/configProfile.test.ts
import { loadConfig, saveConfig, getActiveProfile, invalidateConfigCache } from "../src/core/config.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

describe("Active profile switching integration", () => {
  let originalConfigPath: string | undefined;

  beforeEach(() => {
    // Invalidate the cache to start with a fresh slate
    invalidateConfigCache();
  });

  test("loads default hybrid profile first, then switches instantly to local", async () => {
    // 1. Get initial profile (should be hybrid by default)
    const initialProfile = await getActiveProfile();
    expect(initialProfile.transcription.provider).toBe("groq");
    expect(initialProfile.text.provider).toBe("groq");

    // 2. Change active profile to local
    const config = await loadConfig();
    config.profile = "local";
    await saveConfig(config);

    // 3. Verify it switches immediately (invalidating cache is handled in saveConfig)
    const updatedProfile = await getActiveProfile();
    expect(updatedProfile.transcription.provider).toBe("sidecar_whisper");
    expect(updatedProfile.text.provider).toBe("ollama");

    // 4. Restore to hybrid
    config.profile = "hybrid";
    await saveConfig(config);
    
    const restoredProfile = await getActiveProfile();
    expect(restoredProfile.transcription.provider).toBe("groq");
  });

  test("verifyModelConsistency validates config models correctly", async () => {
    const { verifyModelConsistency } = await import("../src/core/config.js");
    const { REQUIRED_LOCAL_MODELS } = await import("../src/core/ollamaBootstrap.js");
    
    // Should run successfully without throwing
    expect(() => verifyModelConsistency()).not.toThrow();

    // Corrupt REQUIRED_LOCAL_MODELS temporarily
    const originalVision = REQUIRED_LOCAL_MODELS.vision;
    (REQUIRED_LOCAL_MODELS as any).vision = "corrupted-vision-model";

    expect(() => verifyModelConsistency()).toThrow(
      /Model consistency check failed/
    );

    // Restore
    (REQUIRED_LOCAL_MODELS as any).vision = originalVision;
  });
});
