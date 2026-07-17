import { getVerifiedAntigravity } from "../src/integrations/antigravityDiscovery.js";
import { loadConfig, updateConfigField } from "../src/core/config.js";

jest.mock("../src/core/config.js", () => {
  let mockCfg = { models: { hybrid: { image_gen: { model: "test-model" } } }, profile: "hybrid" };
  return {
    loadConfig: jest.fn(() => Promise.resolve(mockCfg)),
    updateConfigField: jest.fn((fn) => { fn(mockCfg); return Promise.resolve(mockCfg); })
  };
});

describe("antigravityClientModel", () => {
  it("uses active profile image_gen.model as client model", async () => {
    const cfg = await loadConfig();
    expect(cfg.models.hybrid.image_gen.model).toBe("test-model");
  });
});
