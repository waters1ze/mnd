// src/core/secrets.ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SECRETS_PATH = join(homedir(), ".config", "mnd", "secrets.enc");
const KEYCHAIN_SERVICE = "mnd-cli";

export interface SecretsStore {
  get(refName: string): Promise<string | null>;
  set(refName: string, value: string): Promise<void>;
  delete(refName: string): Promise<void>;
  hasKey(refName: string): Promise<boolean>;
}

// ─── Keychain backend ────────────────────────────────────────────────────────

async function tryLoadKeyring(): Promise<typeof import("@napi-rs/keyring") | null> {
  try {
    const mod = await import("@napi-rs/keyring");
    return mod;
  } catch {
    return null;
  }
}

class KeychainStore implements SecretsStore {
  private service: string;

  constructor(service: string) {
    this.service = service;
  }

  async get(refName: string): Promise<string | null> {
    try {
      const { Entry } = await import("@napi-rs/keyring");
      const entry = new Entry(this.service, refName);
      return entry.getPassword();
    } catch {
      return null;
    }
  }

  async set(refName: string, value: string): Promise<void> {
    const { Entry } = await import("@napi-rs/keyring");
    const entry = new Entry(this.service, refName);
    entry.setPassword(value);
  }

  async delete(refName: string): Promise<void> {
    const { Entry } = await import("@napi-rs/keyring");
    const entry = new Entry(this.service, refName);
    entry.deletePassword();
  }

  async hasKey(refName: string): Promise<boolean> {
    const val = await this.get(refName);
    return val !== null;
  }
}

// ─── Encrypted file backend (AES-256-GCM) ───────────────────────────────────

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const SALT_LEN = 32;
const TAG_LEN = 16;

/** Passphrase held only in process memory for the session */
let _sessionPassphrase: string | null = null;

export function setSessionPassphrase(pass: string): void {
  _sessionPassphrase = pass;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32) as Buffer;
}

function encrypt(plaintext: string, passphrase: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]);
}

function decrypt(data: Buffer, passphrase: string): string {
  const salt = data.subarray(0, SALT_LEN);
  const iv = data.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = data.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const encrypted = data.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

class EncryptedFileStore implements SecretsStore {
  private cache: Record<string, string> | null = null;

  private async requirePassphrase(): Promise<string> {
    if (_sessionPassphrase) return _sessionPassphrase;
    // Lazy import to avoid circular dependency — prompts only needed at runtime
    const { password } = await import("@clack/prompts");
    const pass = await password({ message: "Enter mnd vault passphrase (secrets encryption):" });
    if (typeof pass !== "string" || !pass) throw new Error("Passphrase required to access secrets");
    _sessionPassphrase = pass;
    return pass;
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    if (!existsSync(SECRETS_PATH)) {
      this.cache = {};
      return this.cache;
    }
    const pass = await this.requirePassphrase();
    const raw = await readFile(SECRETS_PATH);
    const json = decrypt(raw, pass);
    this.cache = JSON.parse(json) as Record<string, string>;
    return this.cache;
  }

  private async save(data: Record<string, string>): Promise<void> {
    const pass = await this.requirePassphrase();
    const json = JSON.stringify(data);
    const encrypted = encrypt(json, pass);
    await mkdir(join(homedir(), ".config", "mnd"), { recursive: true });
    await writeFile(SECRETS_PATH, encrypted);
    this.cache = data;
  }

  async get(refName: string): Promise<string | null> {
    const data = await this.load();
    return data[refName] ?? null;
  }

  async set(refName: string, value: string): Promise<void> {
    const data = await this.load();
    data[refName] = value;
    await this.save(data);
  }

  async delete(refName: string): Promise<void> {
    const data = await this.load();
    delete data[refName];
    await this.save(data);
  }

  async hasKey(refName: string): Promise<boolean> {
    if (!existsSync(SECRETS_PATH)) {
      return false;
    }
    try {
      const data = await this.load();
      return data[refName] !== undefined;
    } catch {
      return false;
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let _store: SecretsStore | null = null;

export async function getSecretsStore(): Promise<SecretsStore> {
  if (_store) return _store;

  const keyringMod = await tryLoadKeyring();
  if (keyringMod) {
    try {
      const entry = new keyringMod.Entry(KEYCHAIN_SERVICE, "__probe__");
      entry.getPassword();
      _store = new KeychainStore(KEYCHAIN_SERVICE);
      return _store;
    } catch {
      // fall through to file backend
    }
  }

  _store = new EncryptedFileStore();
  return _store;
}

export async function secretsHasKey(refName: string): Promise<boolean> {
  const store = await getSecretsStore();
  return store.hasKey(refName);
}

export async function hasKey(refName: string): Promise<boolean> {
  const store = await getSecretsStore();
  return store.hasKey(refName);
}

export async function secretsGet(refName: string): Promise<string | null> {
  const store = await getSecretsStore();
  return store.get(refName);
}
