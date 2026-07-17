import { storeRefreshToken, getRefreshToken, clearRefreshToken } from "../src/auth/tokenStore.js";

describe("TokenStore", () => {
  it("should securely store and retrieve tokens", async () => {
    await storeRefreshToken("user1", "my-secret-token");
    const token = await getRefreshToken("user1");
    expect(token).toBe("my-secret-token");
    
    await clearRefreshToken("user1");
    const deleted = await getRefreshToken("user1");
    expect(deleted).toBeNull();
  });
});
