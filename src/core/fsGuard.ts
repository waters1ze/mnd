import { normalize, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { copyFile as fsCopyFile, rename as fsRename, unlink as fsUnlink, writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import chalk from "chalk";
import { confirm } from "@clack/prompts";

export function isInsideRaw(vaultPath: string, projectSlug: string, targetPath: string): boolean {
  const rawDir = resolve(vaultPath, "Projects", projectSlug, "raw");
  const target = resolve(targetPath);
  return target.startsWith(rawDir + sep) || target === rawDir;
}

export interface SourceChangeProposal {
  operation: "DELETE" | "MODIFY" | "RENAME" | "TRANSCODE";
  targetPath: string;
  reason: string;
}

export async function checkSourceMutation(vaultPath: string, projectSlug: string, proposal: SourceChangeProposal): Promise<void> {
  if (isInsideRaw(vaultPath, projectSlug, proposal.targetPath)) {
    console.log(chalk.red(`\n[IMMUTABLE SOURCE GUARD] Blocking silent mutation of ${proposal.targetPath}`));
    console.log(chalk.yellow(`Reason: ${proposal.reason}`));
    
    const isApproved = await confirm({
      message: `Approve source changes for ${proposal.operation} on ${proposal.targetPath}?`,
      initialValue: false,
    });
    
    if (isApproved !== true) {
      throw new Error(`Source mutation rejected for ${proposal.targetPath}`);
    }
  }
}

// Safe wrappers
export async function safeWriteFile(vaultPath: string, projectSlug: string, targetPath: string, data: any, reason: string): Promise<void> {
  if (existsSync(targetPath)) {
    await checkSourceMutation(vaultPath, projectSlug, { operation: "MODIFY", targetPath, reason });
  } else if (isInsideRaw(vaultPath, projectSlug, targetPath)) {
    // Adding a completely new file to raw/ is acceptable if copying from Inbox, but writing a derived file is not.
    // However, the rule states "No pipeline command may silently: modify bytes in place; rename/move/delete source files; normalize/transcode source files over the original; rewrite metadata". 
    // Adding NEW files to raw/ during sort is allowed, but we still warn if it's an overwrite.
  }
  await fsWriteFile(targetPath, data);
}

export async function safeUnlink(vaultPath: string, projectSlug: string, targetPath: string, reason: string): Promise<void> {
  await checkSourceMutation(vaultPath, projectSlug, { operation: "DELETE", targetPath, reason });
  await fsUnlink(targetPath);
}

export async function safeRename(vaultPath: string, projectSlug: string, oldPath: string, newPath: string, reason: string): Promise<void> {
  await checkSourceMutation(vaultPath, projectSlug, { operation: "RENAME", targetPath: oldPath, reason });
  await checkSourceMutation(vaultPath, projectSlug, { operation: "MODIFY", targetPath: newPath, reason });
  await fsRename(oldPath, newPath);
}

export async function safeCopyFile(vaultPath: string, projectSlug: string, oldPath: string, newPath: string, reason: string): Promise<void> {
  if (existsSync(newPath)) {
    await checkSourceMutation(vaultPath, projectSlug, { operation: "MODIFY", targetPath: newPath, reason });
  }
  await fsCopyFile(oldPath, newPath);
}
