// src/ui/taskList.ts
// listr2 wrapper with ☐/⣋/☑ status indicators
import { Listr } from "listr2";
import chalk from "chalk";
import { theme } from "./theme.js";

export interface TaskItem {
  title: string;
  task: () => Promise<void>;
}

/**
 * Run a list of tasks sequentially with visual progress.
 * Shows ☐ pending, ⣋ (animated) in-progress, ☑ done.
 */
export async function runTaskList(
  header: string,
  tasks: TaskItem[]
): Promise<void> {
  console.log(chalk.hex(theme.accent)(`\n${header}:\n`));

  const listrTasks = tasks.map((t) => ({
    title: t.title,
    task: t.task,
  }));

  const runner = new Listr(listrTasks, {
    concurrent: false,
    renderer: "default",
    rendererOptions: {
      icon: {
        PENDING: chalk.gray(theme.icons.pending),
        COMPLETED: chalk.green(theme.icons.done),
        FAILED: chalk.red("✗"),
        SKIPPED_WITH_COLLAPSE: chalk.gray("⊘"),
        SKIPPED_WITHOUT_COLLAPSE: chalk.gray("⊘"),
      },
      timer: {
        condition: true,
        field: (time: number) => chalk.gray(` ${(time / 1000).toFixed(1)}s`),
      },
    },
  });

  await runner.run();
}
