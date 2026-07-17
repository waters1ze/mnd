// src/auth/types.ts

export type AuthProviderName = "google";

export type AuthStatus =
  | "logged_out"
  | "authorizing"
  | "connected"
  | "refreshing"
  | "login_required"
  | "error";

export interface AccountSummary {
  provider: AuthProviderName;
  status: AuthStatus;
  accountId?: string;
  email?: string;
  displayName?: string;
  scopes: string[];
  connectedAt?: string;
  lastValidatedAt?: string;
}

export interface AuthProvider {
  name: AuthProviderName;
  login(): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  getAccountSummary(): Promise<AccountSummary | null>;
}
