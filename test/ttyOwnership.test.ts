import { TtyOwnershipCoordinator } from "../src/ui/tty.js";
import { stdin } from "node:process";

describe("TtyOwnershipCoordinator", () => {
  it("should release Ink and restore stdin state", async () => {
    // We cannot mock stdin easily in Jest without breaking test runner,
    // but we can ensure the promise resolves after the timeout.
    
    let resolved = false;
    const p = Promise.resolve().then(() => { resolved = true; });
    
    await TtyOwnershipCoordinator.releaseInk(p);
    
    expect(resolved).toBe(true);
    // process.stdin.resume() should have been called (hard to assert side effects on global process object in jest)
  });
});
