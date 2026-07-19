export interface TtyAdapter {
  isTTY: boolean;
  setRawMode(enabled: boolean): void;
  resume(): void;
  pause(): void;
}

export const processTtyAdapter: TtyAdapter = {
  get isTTY() { return process.stdin.isTTY; },
  setRawMode(enabled: boolean) {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(enabled);
    }
  },
  resume() { process.stdin.resume(); },
  pause() { process.stdin.pause(); }
};

export function restoreInteractiveStdin(adapter: TtyAdapter = processTtyAdapter): void {
  if (adapter.isTTY) adapter.setRawMode(false);
  adapter.resume();
}

export async function releaseInkStdin(
  waitUntilExitPromise: Promise<void>,
  adapter: TtyAdapter = processTtyAdapter
): Promise<void> {
  try {
    await waitUntilExitPromise;
    // Yield to allow Ink's internal unmount to fully flush and release stdin
    await new Promise<void>(resolve => setImmediate(resolve));
  } finally {
    restoreInteractiveStdin(adapter);
  }
}
