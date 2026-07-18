import { openRegisteredVault, getWindowsLauncher, findObsidianExecutable } from "../src/integrations/obsidian.js";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

jest.mock("node:child_process", () => ({
  spawn: jest.fn(() => {
    const proc = new EventEmitter() as any;
    proc.unref = jest.fn();
    // Auto-emit spawn so promises resolve
    setTimeout(() => proc.emit("spawn"), 10);
    return proc;
  })
}));

import fs from "node:fs";

describe("obsidianOpen", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("opens registered vault with uri and verifies shell is false", async () => {
    await openRegisteredVault("abc-123", "Home.md");
    expect(spawn).toHaveBeenCalled();
    const args = (spawn as jest.Mock).mock.calls[0];
    const options = args[2];
    expect(options.shell).toBe(false);

    const uriString = args.flat().join(" ");
    expect(uriString).toContain("obsidian://open");
    expect(uriString).toContain("vault=abc-123");
    expect(uriString).toContain("file=Home.md");
  });

  it("falls back to rundll32.exe when obsidian is not found", () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    const launcher = getWindowsLauncher("obsidian://test");
    expect(launcher.exe).toBe("rundll32.exe");
    expect(launcher.args[0]).toBe("url.dll,FileProtocolHandler");
    expect(launcher.args[1]).toBe("obsidian://test");
    jest.restoreAllMocks();
  });

  it("uses exact executable when obsidian is found", () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    const launcher = getWindowsLauncher("obsidian://test2");
    expect(launcher.exe).not.toBe("rundll32.exe");
    expect(launcher.args[0]).toBe("obsidian://test2");
    jest.restoreAllMocks();
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
