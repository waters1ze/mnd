// src/commands/refactor.ts
import { confirm } from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { listRules, writeFrontmatter, gitCommitInVault } from "../core/vault.js";
import { groqChatWithFallback } from "../core/groqClient.js";
import { startThinking, stopThinking } from "../ui/thinkingIndicator.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";

export const handleRefactor: CommandHandler = async (args) => {
  const ruleText = args.join(" ").trim();
  if (!ruleText) {
    console.log(chalk.yellow("Usage: refactor \"description of new rule or improvement\""));
    return;
  }

  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const rules = await listRules(vaultPath);

  if (rules.length === 0) {
    console.log(chalk.gray("No rules in Global_Rules/ yet. Use `fix` to add rules first."));
    return;
  }

  const rulesContext = rules
    .map((r) => `[${r.frontmatter.id}] (${r.frontmatter.category})\n${r.body}`)
    .join("\n---\n");

  const messages = [
    {
      role: "system" as const,
      content: `You are a video editing assistant managing editing rules.
Find the most semantically similar existing rule to the user's description and suggest an improvement.
Return JSON: { "ruleId": "string", "oldBody": "string", "newBody": "string", "reason": "string" }`,
    },
    {
      role: "user" as const,
      content: `Existing rules:\n${rulesContext}\n\nUser wants to improve/refactor: ${ruleText}`,
    },
  ];

  const stop = startThinking("Finding closest rule...");
  let suggestion: { ruleId: string; oldBody: string; newBody: string; reason: string } | null = null;

  try {
    const { result } = await groqChatWithFallback(messages, "refactor", true);
    stop();
    const match = result.match(/\{[\s\S]*\}/);
    if (match) suggestion = JSON.parse(match[0]);
  } catch (err) {
    stop();
    throw err;
  }

  if (!suggestion) {
    console.log(chalk.red("Could not find a matching rule to refactor."));
    return;
  }

  const targetRule = rules.find((r) => r.frontmatter.id === suggestion!.ruleId);
  if (!targetRule) {
    console.log(chalk.red(`Rule ${suggestion.ruleId} not found.`));
    return;
  }

  console.log(chalk.gray("\nProposed change:"));
  console.log(chalk.red(`- ${suggestion.oldBody.trim()}`));
  console.log(chalk.hex(theme.accent)(`+ ${suggestion.newBody.trim()}`));
  console.log(chalk.gray(`\nReason: ${suggestion.reason}`));

  const ok = await confirm({ message: "Apply this refactor?", initialValue: true });
  if (ok !== true) { console.log(chalk.gray("Cancelled.")); return; }

  const updated = { ...targetRule.frontmatter, updated: new Date().toISOString() };
  await writeFrontmatter(
    targetRule.filePath,
    updated,
    `# ${updated.category} Rule\n\n${suggestion.newBody}\n`
  );
  await gitCommitInVault(vaultPath, `refactor: update rule ${updated.id}`, [targetRule.filePath]);

  console.log(chalk.hex(theme.accent)(`✓ Rule ${updated.id} updated.`));
};
