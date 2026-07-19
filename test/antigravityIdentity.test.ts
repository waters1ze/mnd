import { getVerifiedAntigravity } from "../src/integrations/antigravityDiscovery.js";

describe("Antigravity Discovery", () => {
  it("returns a typed discovery result against the locally installed CLI", async () => {
    const res = await getVerifiedAntigravity(false);
    expect(res).toBeDefined();
    expect(typeof res.status).toBe("string");
  }, 60_000);
});
