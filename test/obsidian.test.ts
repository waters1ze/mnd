// test/obsidian.test.ts
import { handleObsidian } from "../src/commands/obsidian.js";
import { exec } from "node:child_process";
import { loadConfig, resolveVaultPath } from "../src/core/config.js";

jest.mock("node:child_process", () => ({
  exec: jest.fn(),
}));

jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn(),
  resolveVaultPath: jest.fn(),
}));

describe("Obsidian command", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("launches Obsidian with correct URI on Win32", async () => {
    const mockConfig = {};
    const mockVaultPath = "C:\\Users\\test\\Vault";
    (loadConfig as jest.Mock).mockResolvedValue(mockConfig);
    (resolveVaultPath as jest.Mock).mockReturnValue(mockVaultPath);

    Object.defineProperty(process, "platform", {
      value: "win32",
    });

    const mockExec = exec as unknown as jest.Mock;
    mockExec.mockImplementation((cmd, callback) => {
      callback(null);
    });

    await handleObsidian([], "");

    const expectedUri = "obsidian://open?path=C%3A%5CUsers%5Ctest%5CVault";
    expect(mockExec).toHaveBeenCalledWith(
      `cmd /c start "" "${expectedUri}"`,
      expect.any(Function)
    );
  });

  test("launches Obsidian with correct URI on Darwin", async () => {
    const mockConfig = {};
    const mockVaultPath = "/Users/test/Vault";
    (loadConfig as jest.Mock).mockResolvedValue(mockConfig);
    (resolveVaultPath as jest.Mock).mockReturnValue(mockVaultPath);

    Object.defineProperty(process, "platform", {
      value: "darwin",
    });

    const mockExec = exec as unknown as jest.Mock;
    mockExec.mockImplementation((cmd, callback) => {
      callback(null);
    });

    await handleObsidian([], "");

    const expectedUri = "obsidian://open?path=%2FUsers%2Ftest%2FVault";
    expect(mockExec).toHaveBeenCalledWith(
      `open "${expectedUri}"`,
      expect.any(Function)
    );
  });
});
