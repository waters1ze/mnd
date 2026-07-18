import { releaseInkStdin, TtyAdapter } from "../src/ui/tty.js";

describe("TtyOwnershipCoordinator / releaseInkStdin", () => {
  it("should release Ink and restore stdin state in exact order: waitUntilExit -> yield -> setRawMode(false) -> resume", async () => {
    let rawModeState = true;
    let resumed = false;
    const executionOrder: string[] = [];

    const mockAdapter: TtyAdapter = {
      isTTY: true,
      setRawMode: jest.fn((enabled) => { 
        rawModeState = enabled; 
        executionOrder.push("setRawMode");
      }),
      resume: jest.fn(() => { 
        resumed = true; 
        executionOrder.push("resume");
      }),
      pause: jest.fn()
    };

    const waitUntilExitPromise = new Promise<void>((resolve) => {
      setImmediate(() => {
        executionOrder.push("waitUntilExit");
        resolve();
      });
    });

    await releaseInkStdin(waitUntilExitPromise, mockAdapter);

    expect(executionOrder).toEqual([
      "waitUntilExit",
      "setRawMode",
      "resume"
    ]);

    expect(mockAdapter.setRawMode).toHaveBeenCalledWith(false);
    expect(rawModeState).toBe(false);
    expect(mockAdapter.resume).toHaveBeenCalled();
    expect(resumed).toBe(true);
  });

  it("should still restore stdin if waitUntilExitPromise rejects", async () => {
    const mockAdapter: TtyAdapter = {
      isTTY: true,
      setRawMode: jest.fn(),
      resume: jest.fn(),
      pause: jest.fn()
    };

    const rejectingPromise = Promise.reject(new Error("Ink error"));
    
    await expect(releaseInkStdin(rejectingPromise, mockAdapter)).rejects.toThrow("Ink error");

    // finally block should still execute!
    expect(mockAdapter.setRawMode).toHaveBeenCalledWith(false);
    expect(mockAdapter.resume).toHaveBeenCalled();
  });
});

