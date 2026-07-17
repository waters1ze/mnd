// Using Jest globals
import { handleDoctor } from "../src/commands/doctor.js";
import { loadConfig } from "../src/core/config.js";

jest.mock("chalk", () => ({
  cyan: jest.fn((s) => s),
  green: jest.fn((s) => s),
  yellow: jest.fn((s) => s),
  red: jest.fn((s) => s),
  bold: jest.fn((s) => s),
  gray: jest.fn((s) => s),
  hex: () => jest.fn((s) => s),
}));

describe("Doctor Integrations", () => {
  it("should have handleDoctor defined", () => {
    expect(typeof handleDoctor).toBe("function");
  });

  // Doctor heavily relies on console.log, we can test that it doesn't throw
  it("should not throw on full report in test mode", async () => {
    // Override log to avoid cluttering test output
    const originalLog = console.log;
    let output = "";
    console.log = (msg: string) => { output += msg + "\\n"; };

    try {
      await handleDoctor([], "");
      expect(output).toContain("MND Doctor Report");
    } finally {
      console.log = originalLog;
    }
  });
});
