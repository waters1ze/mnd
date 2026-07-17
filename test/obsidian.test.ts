// test/obsidian.test.ts
import { normalizeVaultPath, getRegisteredVaultId } from "../src/integrations/obsidian.js";

describe("Obsidian integration", () => {
  test("normalizeVaultPath canonicalizes Windows paths", () => {
    const p1 = "C:\\Users\\Test\\Vault\\";
    const p2 = "c:/users/Test/Vault";
    expect(normalizeVaultPath(p1).toLowerCase()).toBe(normalizeVaultPath(p2).toLowerCase());
  });
  
  test("getRegisteredVaultId returns null if APPDATA is missing", async () => {
    const oldAppData = process.env["APPDATA"];
    delete process.env["APPDATA"];
    const res = await getRegisteredVaultId("C:\\Vault");
    expect(res).toBeNull();
    process.env["APPDATA"] = oldAppData;
  });
});
