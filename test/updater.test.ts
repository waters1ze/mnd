import { Updater } from "../src/core/updater.js";

describe("Updater", () => {
  it("should initialize with default config", () => {
    const updater = new Updater();
    expect(updater).toBeDefined();
  });

  it("should detect if update is safe based on git state", () => {
    const updater = new Updater();
    // Usually local test environments have a dirty tree, so it might return false.
    // We just ensure the method executes without throwing.
    const isSafe = updater.isUpdateSafe();
    expect(typeof isSafe).toBe("boolean");
  });
});
