// src/ui/commandPalette.tsx
import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import chalk from "chalk";
import { COMMAND_REGISTRY, type CommandDefinition } from "../repl/router.js";
import { levenshtein } from "../repl/levenshtein.js";
import { box, HEAVY, pad } from "./box.js";
import { theme } from "./theme.js";

/**
 * Pure command filtering logic:
 * Keep commands where typed text (after /) is a prefix match or Levenshtein distance <= 2 against name.
 */
export function filterCommands(query: string, registry: CommandDefinition[] = COMMAND_REGISTRY): CommandDefinition[] {
  let typedText = query;
  if (typedText.startsWith("/")) {
    typedText = typedText.slice(1);
  }
  const q = typedText.toLowerCase().trim();
  if (!q) return registry;

  return registry.filter((cmd) => {
    const name = cmd.name.toLowerCase();
    // Prefix match
    if (name.startsWith(q)) {
      return true;
    }
    // Levenshtein distance <= 2
    const dist = levenshtein(q, name);
    return dist <= 2;
  });
}

export interface SelectionResult {
  insertText: string;
  closePalette: boolean;
  submit: boolean;
}

export function handleSelection(cmd: CommandDefinition): SelectionResult {
  if (cmd.acceptsArgs) {
    return {
      insertText: `${cmd.slash} `,
      closePalette: true,
      submit: false,
    };
  } else {
    // slash command itself (no args) -> submit directly
    return {
      insertText: cmd.slash,
      closePalette: true,
      submit: true,
    };
  }
}

interface CommandPaletteProps {
  promptText: string;
  onSelect: (command: CommandDefinition, typedQuery: string) => void;
  onCancel: () => void;
}

export function CommandPalette({ promptText, onSelect, onCancel }: CommandPaletteProps): React.ReactElement {
  const [query, setQuery] = useState("/");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const { exit } = useApp();

  const filtered = filterCommands(query, COMMAND_REGISTRY);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      exit();
      return;
    }

    if (key.upArrow) {
      setSelectedIdx((prev) => (filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length));
      return;
    }

    if (key.downArrow) {
      setSelectedIdx((prev) => (filtered.length === 0 ? 0 : (prev + 1) % filtered.length));
      return;
    }

    if (key.return) {
      const selected = filtered[selectedIdx];
      if (selected) {
        onSelect(selected, query);
      } else {
        onCancel();
      }
      exit();
      return;
    }

    if (key.backspace) {
      setQuery((q) => {
        // Do not delete the leading '/'
        if (q.length <= 1) return "/";
        const updated = q.slice(0, -1);
        setSelectedIdx(0);
        return updated;
      });
      return;
    }

    // Capture printable chars
    if (input && !key.meta && !key.ctrl && input.length === 1) {
      setQuery((q) => {
        const updated = q + input;
        setSelectedIdx(0);
        return updated;
      });
    }
  });

  // Render list inside the box
  const lines: string[] = [];

  if (filtered.length === 0) {
    lines.push(pad("  (no matching commands)", 48));
  } else {
    filtered.forEach((cmd, idx) => {
      const isSelected = idx === selectedIdx;
      const maxDescLen = 27;
      let desc = cmd.description;
      if (desc.length > maxDescLen) {
        desc = desc.slice(0, maxDescLen - 1) + "…";
      }

      const lineText = `${isSelected ? " ▸" : "  "} ${cmd.icon}  ${cmd.name.padEnd(12)} - ${desc}`;
      const padded = pad(lineText, 48);
      const finalLine = isSelected
        ? chalk.bgHex(theme.accent).black(padded)
        : padded;
      lines.push(finalLine);
    });
  }

  // Draw separator and footer inside the box
  const separator = HEAVY.ml + HEAVY.h.repeat(48) + HEAVY.mr;
  const footerText = pad(" ↑↓ navigation ⏎ select esc cancel", 48);
  const footerLine = chalk.gray(footerText);

  // We build the box using the box helper from box.ts
  const boxLines = box("Command Palette", lines, {
    width: 48,
    charset: HEAVY,
    color: (s) => chalk.hex(theme.accent)(s),
    titleColor: (s) => chalk.hex(theme.accent)(s),
  });

  // Replace the default bottom border of the box with our separator + footer + bottom border
  const bottomBorder = boxLines.pop()!; // Remove default bottom border
  const finalBoxLines = [
    ...boxLines,
    chalk.hex(theme.accent)(separator),
    chalk.hex(theme.accent)(HEAVY.v) + footerLine + chalk.hex(theme.accent)(HEAVY.v),
    bottomBorder,
  ];

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text>{promptText}</Text>
        <Text>{query}</Text>
        <Text color="gray">█</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {finalBoxLines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    </Box>
  );
}
