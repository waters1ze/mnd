import { resetCancellation, getAbortController, registerProcess, unregisterProcess, requestForceCancellation } from "../src/core/cancellation.js";
import { spawn } from "node:child_process";

describe("cancellation", () => {
  beforeEach(() => {
    resetCancellation();
  });

  afterEach(() => {
    getAbortController().abort();
  });

  test("can register and abort signal", () => {
    const controller = getAbortController();
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  test("can unregister child process", () => {
    const cp = spawn("node", ["-e", "setInterval(() => {}, 1000)"]);
    if (cp.pid) {
      registerProcess({ pid: cp.pid, kind: "python", process: cp, ownedByRun: true });
      unregisterProcess(cp.pid);
    }
    getAbortController().abort();
    expect(cp.killed).toBe(false);
    cp.kill();
  });

  test("force cancellation stops work without terminating the MND process", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await requestForceCancellation();
    expect(exit).not.toHaveBeenCalled();
    expect(getAbortController().signal.aborted).toBe(true);
    exit.mockRestore();
  });
});
