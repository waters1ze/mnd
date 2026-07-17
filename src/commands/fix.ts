// src/commands/fix.ts
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { confirm } from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { writeFrontmatter, gitCommitInVault } from "../core/vault.js";
import { groqChatWithFallback } from "../core/groqClient.js";
import { startThinking, stopThinking } from "../ui/thinkingIndicator.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";
import type { RuleFrontmatter } from "../types/vault.js";

export const handleFix: CommandHandler = async (args) => {
  const errorDescription = args.join(" ").trim();
  if (!errorDescription) {
    console.log(chalk.yellow("Usage: fix \"Description of the error or problem\""));
    return;
  }

  const messages = [
    {
      role: "system" as const,
      content: `You are a video editing assistant. The user found an error or problem in an AI-generated edit. 
Formulate this as a clear, actionable editing rule that prevents this error in the future.
Return JSON: { "category": "string", "rule": "string (1-3 sentences, imperative mood)" }`,
    },
    {
      role: "user" as const,
      content: `Error/problem: ${errorDescription}`,
    },
  ];

  const stop = startThinking("Formulating rule...");
  let formulated: { category: string; rule: string } | null = null;

  try {
    const { result } = await groqChatWithFallback(messages, "fix", true);
    stop();
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      formulated = JSON.parse(match[0]) as { category: string; rule: string };
    }
  } catch (err) {
    stop();
    throw err;
  }

  if (!formulated) {
    console.log(chalk.red("Could not formulate a rule. Try rephrasing the error."));
    return;
  }

  console.log(chalk.gray("\nProposed rule:"));
  console.log(chalk.white(`  Category: ${formulated.category}`));
  console.log(chalk.hex(theme.accent)(`  Rule: "${formulated.rule}"`));

  const ok = await confirm({ message: "Add this rule to Global_Rules?", initialValue: true });
  if (ok !== true) {
    console.log(chalk.gray("Cancelled."));
    return;
  }

  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);

  const id = `rule-${Date.now()}`;
  const now = new Date().toISOString();
  const filePath = join(vaultPath, "Global_Rules", `${id}.md`);

  const frontmatter: RuleFrontmatter = {
    id,
    category: formulated.category,
    created: now,
    updated: now,
  };

  await writeFrontmatter(filePath, frontmatter, `# ${formulated.category} Rule\n\n${formulated.rule}\n`);
  await gitCommitInVault(vaultPath, `fix: add rule ${id} (${formulated.category})`, [filePath]);

  console.log(chalk.hex(theme.accent)(`✓ Rule saved: ${filePath}`));
};
