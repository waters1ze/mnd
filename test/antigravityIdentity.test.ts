import { getVerifiedAntigravity } from "../src/integrations/antigravityDiscovery.js";

describe("Antigravity Discovery", () => {
  it("should fail gracefully when offline", async () => {
    const res = await getVerifiedAntigravity(false);
    expect(res).toBeDefined();
    expect(typeof res.status).toBe("string");
  });
});
