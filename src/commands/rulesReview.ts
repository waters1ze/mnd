// src/commands/rulesReview.ts
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { listRules } from "../core/vault.js";
import { groqChatWithFallback } from "../core/groqClient.js";
import { startThinking, stopThinking } from "../ui/thinkingIndicator.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";

interface RuleConflict {
  type: "contradiction" | "duplicate";
  ruleIds: string[];
  description: string;
}

export const handleRulesReview: CommandHandler = async () => {
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const rules = await listRules(vaultPath);

  if (rules.length === 0) {
    console.log(chalk.gray("No rules in Global_Rules/ yet."));
    return;
  }

  // Group by category
  const byCategory = new Map<string, typeof rules>();
  for (const rule of rules) {
    const cat = rule.frontmatter.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(rule);
  }

  console.log(chalk.hex(theme.accent)(`\nReviewing ${rules.length} rules across ${byCategory.size} categories...`));

  const rulesText = rules
    .map((r) => `[${r.frontmatter.id}] Category: ${r.frontmatter.category}\n${r.body.trim()}`)
    .join("\n---\n");

  const messages = [
    {
      role: "system" as const,
      content: `You are a video editing rules reviewer. Analyze the given editing rules and identify any contradictions or duplicates.
Return JSON: { "conflicts": [{ "type": "contradiction|duplicate", "ruleIds": ["id1", "id2"], "description": "string" }] }
If no conflicts found, return { "conflicts": [] }
IMPORTANT: Never suggest deleting rules — only identify conflicts for human review.`,
    },
    {
      role: "user" as const,
      content: `Editing rules to review:\n${rulesText}`,
    },
  ];

  const stop = startThinking("Analyzing rules for conflicts...");
  let conflicts: RuleConflict[] = [];

  try {
    const { result } = await groqChatWithFallback(messages, "rulesReview", true);
    stop();
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { conflicts: RuleConflict[] };
      conflicts = parsed.conflicts ?? [];
    }
  } catch (err) {
    stop();
    throw err;
  }

  if (conflicts.length === 0) {
    console.log(chalk.hex(theme.accent)("✓ No conflicts found in Global_Rules."));
    return;
  }

  console.log(chalk.yellow(`\n⚠ Found ${conflicts.length} conflict(s) — manual resolution required:\n`));

  for (const [i, conflict] of conflicts.entries()) {
    const typeLabel = conflict.type === "contradiction"
      ? chalk.red("CONTRADICTION")
      : chalk.yellow("DUPLICATE");
    console.log(`  ${i + 1}. ${typeLabel}`);
    console.log(chalk.gray(`     Rules: ${conflict.ruleIds.join(", ")}`));
    console.log(chalk.white(`     ${conflict.description}`));
    console.log();
  }

  console.log(chalk.gray("Resolve by editing rule files in Global_Rules/ and running `refactor` or `fix`."));
  console.log(chalk.gray("mnd never deletes rules automatically."));
};
