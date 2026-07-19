// src/ui/replInput.tsx
import React, { useState, useEffect } from "react";
import chalk from "chalk";
import { Box, Text, useInput, useApp } from "ink";
import { COMMAND_REGISTRY, CURRENT_CONTEXT, type CommandDefinition } from "../repl/router.js";
import { levenshtein } from "../repl/levenshtein.js";
import { pad, box, HEAVY } from "./box.js";
import { theme } from "./theme.js";
import { navigateHistory } from "../repl/history.js";

// Exact -> Prefix -> Substring -> Fuzzy
export function filterCommands(query: string, registry: CommandDefinition[] = COMMAND_REGISTRY): CommandDefinition[] {
  let typedText = query;
  if (typedText.startsWith("/")) {
    typedText = typedText.slice(1);
  }
  const q = typedText.toLowerCase().trim();
  if (!q) return registry;

  const exact: CommandDefinition[] = [];
  const prefix: CommandDefinition[] = [];
  const substring: CommandDefinition[] = [];
  const fuzzy: CommandDefinition[] = [];

  for (const cmd of registry) {
    const name = cmd.name.toLowerCase();
    let isAliasExact = false;
    let isAliasPrefix = false;
    let isAliasSubstring = false;

    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        if (alias.toLowerCase() === q) isAliasExact = true;
        else if (alias.toLowerCase().startsWith(q)) isAliasPrefix = true;
        else if (alias.toLowerCase().includes(q)) isAliasSubstring = true;
      }
    }

    if (name === q || isAliasExact) {
      exact.push(cmd);
    } else if (name.startsWith(q) || isAliasPrefix) {
      prefix.push(cmd);
    } else if (name.includes(q) || isAliasSubstring) {
      substring.push(cmd);
    } else {
      const dist = levenshtein(q, name);
      if (dist <= 2) {
        fuzzy.push(cmd);
      }
    }
  }

  return [...exact, ...prefix, ...substring, ...fuzzy];
}

export interface SelectionResult {
  insertText: string;
  closePalette: boolean;
  submit: boolean;
}

export function handleSelection(cmd: CommandDefinition): SelectionResult {
  if (cmd.acceptsArgs) {
    return { insertText: `${cmd.slash} `, closePalette: true, submit: false };
  } else {
    return { insertText: cmd.slash, closePalette: true, submit: true };
  }
}

export function hasCommandArguments(input: string): boolean {
  return /^\/\S+\s/.test(input);
}

interface ReplInputProps {
  promptText: string;
  initialInput?: string;
  onSubmit: (text: string) => void;
}

export function ReplInput({ promptText, initialInput = "", onSubmit }: ReplInputProps): React.ReactElement {
  const [input, setInput] = useState(initialInput);
  const [cursorIdx, setCursorIdx] = useState(initialInput.length);
  const [showPalette, setShowPalette] = useState(initialInput.startsWith("/"));
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [notice, setNotice] = useState("");
  const { exit } = useApp();

  const filtered = showPalette ? filterCommands(input, COMMAND_REGISTRY) : [];
  
  // Safe bounds check
  const actualSelectedIdx = filtered.length > 0 ? Math.min(selectedIdx, filtered.length - 1) : 0;
  const selectedCmd = filtered[actualSelectedIdx];
  const availability = selectedCmd?.availability ? selectedCmd.availability(CURRENT_CONTEXT) : { enabled: true };

  useInput(async (char, key) => {
    if (key.ctrl && (char.toLowerCase() === "c" || char.toLowerCase() === "d")) {
      setInput("");
      setCursorIdx(0);
      setShowPalette(false);
      setNotice("MND остаётся запущенным · для выхода введите exit");
      return;
    }

    if (key.escape) {
      if (showPalette) {
        setShowPalette(false);
      } else {
        setInput("");
        setCursorIdx(0);
        setNotice("Ввод очищен · MND продолжает работать");
      }
      return;
    }

    if (key.return) {
      if (showPalette) {
        if (selectedCmd) {
          if (!availability.enabled) return; // Cannot select disabled command

          const res = handleSelection(selectedCmd);
          if (res.submit) {
            onSubmit(res.insertText);
            exit();
          } else {
            setInput(res.insertText);
            setCursorIdx(res.insertText.length);
            setShowPalette(false);
          }
        } else {
          onSubmit(input);
          exit();
        }
      } else {
        onSubmit(input);
        exit();
      }
      return;
    }

    if (key.tab && showPalette) {
      if (selectedCmd && availability.enabled) {
        const res = handleSelection(selectedCmd);
        setInput(res.insertText);
        setCursorIdx(res.insertText.length);
        setShowPalette(false);
      }
      return;
    }

    if (showPalette && key.upArrow) {
      setSelectedIdx((prev) => (filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length));
      return;
    }

    if (showPalette && key.downArrow) {
      setSelectedIdx((prev) => (filtered.length === 0 ? 0 : (prev + 1) % filtered.length));
      return;
    }

    // Normal history navigation
    if (!showPalette && key.upArrow) {
      const older = await navigateHistory("up", input);
      setInput(older);
      setCursorIdx(older.length);
      return;
    }

    if (!showPalette && key.downArrow) {
      const newer = await navigateHistory("down", input);
      setInput(newer);
      setCursorIdx(newer.length);
      return;
    }

    if (key.leftArrow) {
      setCursorIdx((i) => Math.max(0, i - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorIdx((i) => Math.min(input.length, i + 1));
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorIdx > 0) {
        const nextInput = input.slice(0, cursorIdx - 1) + input.slice(cursorIdx);
        setInput(nextInput);
        setCursorIdx((i) => i - 1);
        if (showPalette && nextInput === "") {
          setShowPalette(false);
        }
        setSelectedIdx(0);
      }
      return;
    }

    // printable chars
    if (char && !key.meta && !key.ctrl) {
      setNotice("");
      const nextInput = input.slice(0, cursorIdx) + char + input.slice(cursorIdx);
      setInput(nextInput);
      setCursorIdx((i) => i + char.length);
      
      if (char === "/" && nextInput === "/") {
        setShowPalette(true);
      } else if (showPalette && hasCommandArguments(nextInput)) {
        // The user is now typing a free-text argument, not looking for a
        // second command. Keep the prompt clear and usable.
        setShowPalette(false);
      }
      setSelectedIdx(0);
    }
  });

  const beforeCursor = input.slice(0, cursorIdx);
  const atCursor = cursorIdx < input.length ? input[cursorIdx] : " ";
  const afterCursor = cursorIdx < input.length ? input.slice(cursorIdx + 1) : "";

  // Render palette lines
  const lines: string[] = [];
  if (showPalette) {
    if (filtered.length === 0) {
      lines.push(pad("  (no matching commands)", 58));
    } else {
      // scroll logic
      const maxRows = 8;
      const startIdx = Math.max(0, Math.min(actualSelectedIdx - 3, filtered.length - maxRows));
      const endIdx = Math.min(filtered.length, startIdx + maxRows);
      
      const visible = filtered.slice(startIdx, endIdx);

      if (startIdx > 0) lines.push(pad("  ...", 58));

      visible.forEach((cmd, idx) => {
        const absoluteIdx = startIdx + idx;
        const isSelected = absoluteIdx === actualSelectedIdx;
        const cmdAvail = cmd.availability ? cmd.availability(CURRENT_CONTEXT) : { enabled: true };
        
        const maxDescLen = 27;
        let desc = cmd.description;
        if (desc.length > maxDescLen) {
          desc = desc.slice(0, maxDescLen - 1) + "…";
        }
        
        const prefix = isSelected ? " ▸" : "  ";
        const icon = cmd.icon;
        const namePad = cmd.name.padEnd(12);
        
        const isDim = !cmdAvail.enabled;
        const baseText = `${prefix} ${icon}  ${namePad} - ${desc}`;
        const lineText = isDim ? chalk.gray(baseText) : baseText;

        const padded = pad(lineText, 58);
        const finalLine = isSelected
          ? (isDim ? chalk.bgHex(theme.accent).gray(padded) : chalk.bgHex(theme.accent).black(padded))
          : padded;
          
        lines.push(finalLine);

        // If selected and disabled, show reason
        if (isSelected && isDim && cmdAvail.reason) {
          lines.push(pad(`    └─ Disabled: ${cmdAvail.reason}`, 58));
          if (cmdAvail.suggestedActions) {
            lines.push(pad(`       Actions: ${cmdAvail.suggestedActions.join(" | ")}`, 58));
          }
        }
      });

      // Project names are visible before Enter: typing /open is enough to see
      // what can be opened, while Enter still opens the richer selector.
      if (input.trim().toLowerCase() === "/open") {
        const projects = CURRENT_CONTEXT.projects ?? [];
        lines.push(pad(chalk.hex(theme.accent)("  Projects"), 58));
        if (projects.length === 0) {
          lines.push(pad(chalk.gray("    No projects found. Use /create first."), 58));
        } else {
          for (const project of projects.slice(0, 5)) {
            lines.push(pad(`    ◇  ${project.title}  ${chalk.gray(`[${project.slug}] · ${project.status}`)}`, 58));
          }
          if (projects.length > 5) lines.push(pad(chalk.gray(`    + ${projects.length - 5} more projects`), 58));
        }
      }

      if (endIdx < filtered.length) lines.push(pad("  ...", 58));
    }
  }

  let paletteBox: React.ReactNode = null;
  if (showPalette) {
    const boxLines = box("Commands", lines, {
      width: 58,
      charset: HEAVY,
      color: (s) => chalk.hex(theme.accent)(s),
      titleColor: (s) => chalk.hex(theme.accent)(s),
    });
    
    const separator = HEAVY.ml + HEAVY.h.repeat(58) + HEAVY.mr;
    const footerText = pad(" ↑↓ navigate   Tab complete   Enter select   Esc close", 58);
    const footerLine = chalk.gray(footerText);
    
    const bottomBorder = boxLines.pop()!;
    const finalBoxLines = [
      ...boxLines,
      chalk.hex(theme.accent)(separator),
      chalk.hex(theme.accent)(HEAVY.v) + footerLine + chalk.hex(theme.accent)(HEAVY.v),
      bottomBorder,
    ];

    paletteBox = (
      <Box flexDirection="column" marginTop={0}>
        {finalBoxLines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text>{promptText}</Text>
        <Text>{beforeCursor}</Text>
        <Text inverse>{atCursor}</Text>
        <Text>{afterCursor}</Text>
      </Box>
      {paletteBox}
      {notice ? <Text color="gray">  {notice}</Text> : null}
    </Box>
  );
}
