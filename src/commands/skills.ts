import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { listSkills } from "../core/vault.js";
import type { CommandHandler } from "../repl/router.js";
import { box, LIGHT } from "../ui/box.js";
import { theme } from "../ui/theme.js";

export const handleSkills: CommandHandler = async (args) => {
  const config = await loadConfig();
  const skills = await listSkills(resolveVaultPath(config));
  const requested = args.join(" ").trim().toLocaleLowerCase("ru-RU");
  const visible = requested
    ? skills.filter((skill) => skill.name.toLocaleLowerCase("ru-RU").includes(requested) || skill.frontmatter.id.toLocaleLowerCase("ru-RU").includes(requested))
    : skills;
  if (visible.length === 0) {
    console.log(chalk.gray(requested ? `Skill "${requested}" not found.` : "No MND skills installed."));
    return;
  }
  const lines = visible.sort((left, right) => left.name.localeCompare(right.name, "ru")).flatMap((skill) => [
    `  ${chalk.hex(theme.accent)(skill.name)}  ${chalk.gray(skill.frontmatter.status ?? "legacy")}`,
    `  ${chalk.gray((skill.frontmatter.capabilities ?? []).join(", ") || "prompt instructions")}`,
  ]);
  console.log(box(` MND SKILLS · ${visible.length} `, lines, { width: 72, charset: LIGHT }).join("\n"));
};
