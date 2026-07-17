// src/auth/accountState.ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAppDataDir } from "../core/paths.js";
import type { AccountSummary } from "./types.js";

const ACCOUNT_FILE_PATH = join(getAppDataDir(), "account.json");

export async function getAccountState(): Promise<AccountSummary | null> {
  if (!existsSync(ACCOUNT_FILE_PATH)) {
    return null;
  }
  try {
    const data = await readFile(ACCOUNT_FILE_PATH, "utf-8");
    return JSON.parse(data) as AccountSummary;
  } catch (error) {
    return null;
  }
}

export function getAccountStateSync(): AccountSummary | null {
  if (!existsSync(ACCOUNT_FILE_PATH)) return null;
  try {
    const { readFileSync } = require("node:fs");
    const data = readFileSync(ACCOUNT_FILE_PATH, "utf-8");
    return JSON.parse(data) as AccountSummary;
  } catch (error) {
    return null;
  }
}

export async function saveAccountState(state: AccountSummary): Promise<void> {
  await mkdir(getAppDataDir(), { recursive: true });
  // Atomic write
  const { atomicWriteFile } = await import("../core/atomic.js");
  await atomicWriteFile(ACCOUNT_FILE_PATH, JSON.stringify(state, null, 2));
}

export async function clearAccountState(): Promise<void> {
  if (existsSync(ACCOUNT_FILE_PATH)) {
    const { rm } = await import("node:fs/promises");
    await rm(ACCOUNT_FILE_PATH, { force: true });
  }
}
