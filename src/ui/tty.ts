export class TtyOwnershipCoordinator {
  static async releaseInk(waitUntilExitPromise: Promise<void>): Promise<void> {
    await waitUntilExitPromise;
    // Yield to allow Ink's internal unmount to fully flush and release stdin
    await new Promise<void>(resolve => setImmediate(resolve));
    
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
    process.stdin.resume();
  }
}
