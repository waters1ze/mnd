// src/auth/tokenStore.ts
import { secretsGet, getSecretsStore } from "../core/secrets.js";

const TOKEN_PREFIX = "mnd.google.oauth";

function getRefreshTokenKey(accountId: string): string {
  return `${TOKEN_PREFIX}.${accountId}_refresh`;
}

export async function storeRefreshToken(accountId: string, refreshToken: string): Promise<void> {
  const store = await getSecretsStore();
  await store.set(getRefreshTokenKey(accountId), refreshToken);
}

export async function getRefreshToken(accountId: string): Promise<string | null> {
  return secretsGet(getRefreshTokenKey(accountId));
}

export async function clearRefreshToken(accountId: string): Promise<void> {
  const store = await getSecretsStore();
  await store.delete(getRefreshTokenKey(accountId));
}
