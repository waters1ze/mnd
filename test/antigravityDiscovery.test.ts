import { discoverAntigravityCli, getVerifiedAntigravity, invalidateAntigravityCache } from "../src/integrations/antigravityDiscovery.js";
import { EventEmitter } from "events";

jest.mock("node:fs", () => ({
  existsSync: jest.fn().mockReturnValue(true)
}));

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
    
    // Simulate real behavior based on test state
    if (cmd.includes("antigravity")) {
      const mode = (global as any).__mockAntigravityMode || "normal";
      
      if (mode === "not_antigravity") {
        if (argsArray.includes("--help")) return cb(null, "Usage: someapp\n", "");
        if (argsArray.includes("--version")) return cb(null, "1.0\n", "");
      }
      
      if (mode === "no_json") {
        if (argsArray.includes("--help")) return cb(null, "Usage: antigravity\n", "");
        if (argsArray.includes("--version")) return cb(null, "antigravity 1.0\n", "");
      }
      
      if (mode === "stderr") {
        if (argsArray.includes("--help")) return cb(null, "", "Usage: antigravity\n--json-io\n");
        if (argsArray.includes("--version")) return cb(null, "", "antigravity 1.0\n");
      }

      if (argsArray.includes("--help")) {
        return cb(null, "Usage: antigravity [options]\n--json-io Enable JSON IO\nAntigravity version 1.0.0\n", "");
      }
      if (argsArray.includes("--version")) {
        return cb(null, "antigravity 1.0.0\n", "");
      }
    }
    cb(new Error("Command failed"), null, "");
  }),
  spawn: jest.fn((cmd, args) => {
    const proc = new EventEmitter() as any;
    proc.kill = jest.fn();
    proc.stderr = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stdin = { write: jest.fn(), end: jest.fn() };
    
    const mode = (global as any).__mockAntigravitySmoke || "pass";
    
    if (mode === "crash") {
      setTimeout(() => proc.emit("exit", 1), 10);
    }
    
    return proc;
  })
}));

jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({ connections: {} }),
  updateConfigField: jest.fn().mockResolvedValue(undefined)
}));

describe("antigravityDiscovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateAntigravityCache();
    (global as any).__mockAntigravityMode = "normal";
    (global as any).__mockAntigravitySmoke = "pass";
  });

  it("coalesces discovery scans", async () => {
    const p1 = discoverAntigravityCli();
    const p2 = discoverAntigravityCli();
    expect(p1).toBe(p2);
    const res = await p1;
    expect(res.status).toBe("transport_ready");
  });

  it("RELEASE_ASSERTION: R08-ANTIGRAVITY-DISCOVERY verifies protocol via --help and starts process", async () => {
    const res = await getVerifiedAntigravity(true);
    expect(res.status).toBe("transport_ready");
  });

  it("fails if not antigravity", async () => {
    (global as any).__mockAntigravityMode = "not_antigravity";
    const res = await getVerifiedAntigravity(true);
    expect(res.status).toBe("not_found");
    expect(res.installation?.verifiedCapabilities).toBeUndefined();
  });

  it("fails if protocol missing", async () => {
    (global as any).__mockAntigravityMode = "no_json";
    const res = await getVerifiedAntigravity(true);
    expect(res.status).toBe("unsupported");
    expect(res.installation?.verifiedCapabilities).toBeUndefined();
  });

  it("supports reading from stderr", async () => {
    (global as any).__mockAntigravityMode = "stderr";
    const res = await getVerifiedAntigravity(true);
    expect(res.status).toBe("transport_ready");
  });

  it("fails smoke check if process crashes immediately", async () => {
    (global as any).__mockAntigravityMode = "normal";
    (global as any).__mockAntigravitySmoke = "crash";
    const res = await getVerifiedAntigravity(true);
    // Since it doesn't return transport_ready, the discovery loop finishes and reports not_found
    expect(res.status).toBe("not_found");
  });
});
