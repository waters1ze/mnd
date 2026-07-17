// src/auth/googleAuth.ts
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getAbortController } from "../core/cancellation.js";
import { storeRefreshToken, getRefreshToken, clearRefreshToken } from "./tokenStore.js";
import { saveAccountState, clearAccountState, getAccountState } from "./accountState.js";
import type { AuthProvider, AuthProviderName, AccountSummary } from "./types.js";

const DEFAULT_SCOPE = "https://www.googleapis.com/auth/drive.file";

export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

export class GoogleOAuthNotConfiguredError extends GoogleOAuthError {
  constructor() {
    super(
      "Google OAuth is not configured for this build.\n\n" +
      "Development setup:\n" +
      "Set MND_GOOGLE_CLIENT_CONFIG to a Desktop OAuth client JSON file.\n\n" +
      "Google Drive sync is unavailable.\n" +
      "Core editing remains available."
    );
    this.name = "GoogleOAuthNotConfiguredError";
  }
}

interface ClientConfig {
  client_id: string;
  client_secret?: string | undefined;
}

async function getClientConfig(): Promise<ClientConfig> {
  const configPath = process.env.MND_GOOGLE_CLIENT_CONFIG;
  if (configPath && existsSync(configPath)) {
    try {
      const data = await readFile(configPath, "utf-8");
      const json = JSON.parse(data);
      const installed = json.installed || json.web || json;
      if (installed.client_id) {
        return {
          client_id: installed.client_id,
          client_secret: installed.client_secret,
        };
      }
    } catch {
      // JSON parse error or missing fields, fall through
    }
  }

  if (process.env.MND_GOOGLE_CLIENT_ID) {
    return {
      client_id: process.env.MND_GOOGLE_CLIENT_ID,
      client_secret: process.env.MND_GOOGLE_CLIENT_SECRET, // Optional
    };
  }

  throw new GoogleOAuthNotConfiguredError();
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return randomBytes(16).toString("hex");
}

function openBrowser(url: string): void {
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = isWindows ? ["", url] : [url];
  spawn(cmd, args, { shell: isWindows, windowsHide: true });
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

let activeRefreshPromise: Promise<string | null> | null = null;
// Keep token in memory
let memAccessToken: string | null = null;
let memTokenExpiry: number = 0;

export class GoogleAuthProvider implements AuthProvider {
  name: AuthProviderName = "google";

  async login(): Promise<void> {
    const config = await getClientConfig();
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = generateState();
    
    // Create run-scoped AbortController
    const runController = new AbortController();

    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      let isCompleted = false;
      let redirectUri = "";

      let cleanup = (server: any) => {
        if (isCompleted) return;
        isCompleted = true;
        clearTimeout(timeoutId);
        runController.abort();
        server.close();
      };

      const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (isCompleted) return;
          
          if (req.method !== "GET") {
            res.writeHead(405);
            res.end("Method Not Allowed");
            return;
          }

          const url = new URL(req.url || "/", `http://${req.headers.host}`);
          if (url.pathname !== "/oauth/callback") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }

          const queryError = url.searchParams.get("error");
          if (queryError) {
            throw new GoogleOAuthError(`OAuth Error: ${queryError}`);
          }

          const code = url.searchParams.get("code");
          const returnedState = url.searchParams.get("state");

          if (!code || !returnedState) {
            throw new GoogleOAuthError("Missing code or state from callback");
          }

          const stateBuf = Buffer.from(state);
          const returnedStateBuf = Buffer.from(returnedState);
          if (stateBuf.length !== returnedStateBuf.length || !timingSafeEqual(stateBuf, returnedStateBuf)) {
            throw new GoogleOAuthError("State mismatch. Possible CSRF attack.");
          }

          // We got the code
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<html><body><h1>Authentication successful!</h1><p>You may close this window and return to MND.</p></body></html>");
          
          // Cleanup server after success response sent
          cleanup(server);
          
          let tokenRes;
          try {
            tokenRes = await fetch("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: config.client_id,
                ...(config.client_secret ? { client_secret: config.client_secret } : {}),
                code,
                code_verifier: verifier,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
              }),
              signal: runController.signal,
            });
          } catch (e: any) {
            throw new GoogleOAuthError(`Token exchange network error: ${e.message}`);
          }

          if (!tokenRes.ok) {
            const errBody = await tokenRes.text();
            throw new GoogleOAuthError(`Token exchange failed: ${tokenRes.status} ${errBody}`);
          }

          const tokens = (await tokenRes.json()) as TokenResponse;
          
          memAccessToken = tokens.access_token;
          memTokenExpiry = Date.now() + tokens.expires_in * 1000;

          if (tokens.refresh_token) {
            await storeRefreshToken("google-user", tokens.refresh_token);
          }

          // Get profile
          const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
            signal: runController.signal,
          });

          if (!profileRes.ok) {
            // Revoke access token if we failed to get profile so we don't leave bad state
            await fetch("https://oauth2.googleapis.com/revoke", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ token: tokens.access_token }),
            }).catch(() => {});
            throw new GoogleOAuthError(`Failed to fetch profile: ${profileRes.statusText}`);
          }

          const profileData = (await profileRes.json()) as any;
          const email = profileData.email || "unknown@google.com";
          const displayName = profileData.name || "Unknown User";

          const accountId = email; 
          
          const accountSummary: AccountSummary = {
            provider: this.name,
            status: "connected",
            accountId,
            email,
            displayName,
            scopes: tokens.scope ? tokens.scope.split(" ") : [DEFAULT_SCOPE],
            connectedAt: new Date().toISOString(),
            lastValidatedAt: new Date().toISOString(),
          };

          await saveAccountState(accountSummary);
          resolve();

        } catch (error: any) {
          cleanup(server);
          if (!res.headersSent) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<html><body><h1>Authentication Failed</h1><p>Return to terminal for details.</p></body></html>`);
          } else {
            console.error("OAuth Error:", error.message);
          }
          reject(error);
        }
      });

      timeoutId = setTimeout(() => {
        cleanup(server);
        reject(new GoogleOAuthError("Google login timed out (5 minutes)"));
      }, 5 * 60_000);

      // Bind global abort controller to local
      const onGlobalAbort = () => {
        cleanup(server);
        reject(new Error("Login cancelled by user"));
      };
      
      const globalSignal = getAbortController().signal;
      globalSignal.addEventListener("abort", onGlobalAbort);
      const originalCleanup = cleanup;
      // Override cleanup
      cleanup = (serverInstance: any) => {
        originalCleanup(serverInstance);
        globalSignal.removeEventListener("abort", onGlobalAbort);
      };

      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          cleanup(server);
          reject(new GoogleOAuthError("Failed to bind server to a port"));
          return;
        }
        
        redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
          client_id: config.client_id,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: DEFAULT_SCOPE,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
          access_type: "offline",
          prompt: "consent",
        }).toString();

        console.log(`\nOpening browser for Google authentication...`);
        console.log(`If it doesn't open automatically, visit:\n${authUrl}\n`);
        console.log(`Waiting for browser login... (Press Ctrl+C to cancel)`);

        openBrowser(authUrl);
      });
    });
  }

  async logout(): Promise<void> {
    const state = await getAccountState();
    if (!state || !state.accountId) return;

    const token = await getRefreshToken(state.accountId);
    
    // Attempt remote revocation
    if (token) {
      try {
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(5000), // Timeout after 5s
        });
      } catch {
        console.warn("Failed to remotely revoke token. Removing local token anyway.");
      }
      await clearRefreshToken(state.accountId);
    }

    memAccessToken = null;
    memTokenExpiry = 0;
    activeRefreshPromise = null;

    await clearAccountState();
  }

  async refresh(): Promise<void> {
    await this.getAccessToken(true);
  }

  async getAccessToken(forceRefresh = false): Promise<string | null> {
    if (!forceRefresh && memAccessToken && Date.now() < memTokenExpiry - 60000) {
      return memAccessToken; // Return cached if valid for at least 1 more minute
    }

    if (activeRefreshPromise) {
      return activeRefreshPromise;
    }

    activeRefreshPromise = (async () => {
      try {
        const state = await getAccountState();
        if (!state || !state.accountId) return null;

        const config = await getClientConfig().catch(() => null);
        if (!config) return null; // Can't refresh without client config

        const refresh_token = await getRefreshToken(state.accountId);
        if (!refresh_token) {
          await this._setLoginRequired(state);
          return null;
        }

        const bodyParams: Record<string, string> = {
          client_id: config.client_id,
          refresh_token,
          grant_type: "refresh_token",
        };
        if (config.client_secret) {
          bodyParams.client_secret = config.client_secret;
        }

        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(bodyParams),
        });

        if (!tokenRes.ok) {
          if (tokenRes.status === 400 || tokenRes.status === 401) {
            // Token likely revoked
            await this._setLoginRequired(state);
          }
          throw new GoogleOAuthError(`Failed to refresh token: ${tokenRes.statusText}`);
        }

        const tokens = (await tokenRes.json()) as TokenResponse;
        memAccessToken = tokens.access_token;
        memTokenExpiry = Date.now() + tokens.expires_in * 1000;

        state.lastValidatedAt = new Date().toISOString();
        if (state.status !== "connected") {
            state.status = "connected";
        }
        await saveAccountState(state);

        return memAccessToken;
      } finally {
        activeRefreshPromise = null;
      }
    })();

    return activeRefreshPromise;
  }

  private async _setLoginRequired(state: AccountSummary) {
    state.status = "login_required";
    await saveAccountState(state);
    memAccessToken = null;
    memTokenExpiry = 0;
  }

  async getAccountSummary(): Promise<AccountSummary | null> {
    return getAccountState();
  }
}
