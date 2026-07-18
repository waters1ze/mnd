import { releaseInkStdin, TtyAdapter } from "../src/ui/tty.js";

describe("TtyOwnershipCoordinator / releaseInkStdin", () => {
  it("should release Ink and restore stdin state via adapter", async () => {
    let rawModeState = true;
    let resumed = false;

    const mockAdapter: TtyAdapter = {
      isTTY: true,
      setRawMode: jest.fn((enabled) => { rawModeState = enabled; }),
      resume: jest.fn(() => { resumed = true; }),
      pause: jest.fn()
    };

    let promiseResolved = false;
    const waitUntilExitPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        promiseResolved = true;
        resolve();
      }, 10);
    });

    await releaseInkStdin(waitUntilExitPromise, mockAdapter);

    expect(promiseResolved).toBe(true);
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

