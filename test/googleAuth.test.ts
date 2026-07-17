import { GoogleAuthProvider } from "../src/auth/googleAuth.js";

describe("GoogleAuthProvider", () => {
  it("should initialize without errors", () => {
    // Tests that the constructor runs without failure
    // It shouldn't crash just because env vars are missing, 
    // it delays failure to login() if needed, or falls back.
    const provider = new GoogleAuthProvider();
    expect(provider).toBeDefined();
  });
});
