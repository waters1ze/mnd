// Using Jest globals
import { registerVaultSafely, getRegisteredVaultId } from "../src/integrations/obsidian.js";
import fs from "node:fs";
import path from "node:path";

// Mock fs
jest.mock("node:fs", () => {
  const actual = jest.requireActual("node:fs");
  return { ...actual };
});
jest.mock("node:fs/promises", () => {
  const actual = jest.requireActual("node:fs/promises");
  return { ...actual };
});

describe("Obsidian Integration", () => {
  let origAppData: string | undefined;

  beforeAll(() => {
    origAppData = process.env["APPDATA"];
    process.env["APPDATA"] = "/fake/appdata/dir";
  });

  afterAll(() => {
    process.env["APPDATA"] = origAppData;
  });

  it("getRegisteredVaultId should return null for missing json", async () => {
    // we just check it doesn't throw
    const res = await getRegisteredVaultId(path.resolve("some-fake-path"));
    expect(res).toBeNull();
  });

  it("registerVaultSafely should fail gracefully if obsidian.json does not exist", async () => {
    const res = await registerVaultSafely(path.resolve("some-fake-path"));
    expect(res.success).toBe(false);
  });
});
