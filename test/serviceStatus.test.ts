import { antigravityStatusLabel, looksLikeApiSecret, safeConfigDisplayValue } from "../src/ui/serviceStatus.js";

describe("Antigravity UI status", () => {
  test("shows initialization until discovery completes", () => {
    expect(antigravityStatusLabel(true, "transport_ready")).toBe("Initializing...");
    expect(antigravityStatusLabel(false)).toBe("Initializing...");
  });

  test("shows Ready for every usable transport stage", () => {
    expect(antigravityStatusLabel(false, "transport_ready")).toBe("✓ Ready");
    expect(antigravityStatusLabel(false, "operation_verified")).toBe("✓ Ready");
  });

  test("never renders a raw API secret from a legacy config", () => {
    const secret = "gsk_exampleSecretValue123456";
    expect(looksLikeApiSecret(secret)).toBe(true);
    expect(safeConfigDisplayValue(secret)).not.toContain(secret);
    expect(safeConfigDisplayValue("groq_api_key")).toBe("groq_api_key");
  });
});
