import { discoverAntigravityCli, getVerifiedAntigravity } from "../src/integrations/antigravityDiscovery.js";

jest.mock("node:child_process", () => ({
  execFile: jest.fn((cmd, args, optionsOrCb, cbOrNone) => {
    let cb;
    let argsArray = args;
    if (typeof optionsOrCb === "function") {
      cb = optionsOrCb;
    } else {
      cb = cbOrNone;
    }

    if (cmd === "where" || cmd === "which" || cmd === "reg.exe") {
      return cb(null, "C:\\mock\\antigravity.exe\n", "");
    }
    if (cmd.includes("antigravity.exe") && (argsArray.includes("--help") || argsArray.includes("--version"))) {
      return cb(null, "Usage: antigravity [options]\n--json-io Enable JSON IO\nAntigravity version 1.0.0\n", "");
    }
    cb(new Error("Command failed"), null);
  })
}));

jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({ connections: {} }),
  updateConfigField: jest.fn().mockResolvedValue(undefined)
}));

describe("antigravityDiscovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("coalesces discovery scans", async () => {
    const p1 = discoverAntigravityCli();
    const p2 = discoverAntigravityCli();
    expect(p1).toBe(p2);
    const res = await p1;
    expect(res.status).toBe("ready");
  });

  it("verifies protocol via --help", async () => {
    const res = await getVerifiedAntigravity(true);
    expect(res.status).toBe("ready");
  });
});
