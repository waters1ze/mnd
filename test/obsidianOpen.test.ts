import { openRegisteredVault, getWindowsLauncher } from "../src/integrations/obsidian.js";
import { spawn } from "node:child_process";

jest.mock("node:child_process", () => ({
  spawn: jest.fn(() => ({ unref: jest.fn() }))
}));

describe("obsidianOpen", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("opens registered vault with uri", async () => {
    await openRegisteredVault("abc-123", "Home.md");
    expect(spawn).toHaveBeenCalled();
    const args = (spawn as jest.Mock).mock.calls[0];
    const uriString = args.flat().join(" ");
    expect(uriString).toContain("obsidian://open");
    expect(uriString).toContain("vault=abc-123");
    expect(uriString).toContain("file=Home.md");
  });

  it("safely builds Windows launcher args with special characters", () => {
    const vaultId = "my vault & % #";
    const homeNote = 'home "note" with spaces & Cyrillic Привет';
    
    const uriObj = new URL("obsidian://open");
    uriObj.searchParams.set("vault", vaultId);
    uriObj.searchParams.set("file", homeNote);
    const uri = uriObj.toString();
    
    // Should be correctly encoded
    expect(uri).toContain("vault=my+vault+%26+%25+%23");
    expect(uri).toContain("file=home+%22note%22+with+spaces+%26+Cyrillic+%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82");
    
    const launcher = getWindowsLauncher(uri);
    
    // The launcher args must have exactly the uri
    expect(launcher.args[launcher.args.length - 1]).toBe(uri);
  });
});
