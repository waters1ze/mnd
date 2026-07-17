import React, { useState } from "react";
import chalk from "chalk";
import { Box, Text, useInput, useApp } from "ink";
import { COMMAND_REGISTRY, type CommandDefinition } from "../repl/router.js";
import { levenshtein } from "../repl/levenshtein.js";
import { pad, box, HEAVY } from "./box.js";
import { theme } from "./theme.js";

export function filterCommands(query: string, registry: CommandDefinition[] = COMMAND_REGISTRY): CommandDefinition[] {
  let typedText = query;
  if (typedText.startsWith("/")) {
    typedText = typedText.slice(1);
  }
  const q = typedText.toLowerCase().trim();
  if (!q) return registry;

  return registry.filter((cmd) => {
    const name = cmd.name.toLowerCase();
    if (name.startsWith(q)) return true;
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
    return { insertText: `${cmd.slash} `, closePalette: true, submit: false };
  } else {
    return { insertText: cmd.slash, closePalette: true, submit: true };
  }
}

interface ReplInputProps {
  promptText: string;
  initialInput?: string;
  onSubmit: (text: string) => void;
  onExit: () => void;
}

export function ReplInput({ promptText, initialInput = "", onSubmit, onExit }: ReplInputProps): React.ReactElement {
  const [input, setInput] = useState(initialInput);
  const [cursorIdx, setCursorIdx] = useState(initialInput.length);
  const [showPalette, setShowPalette] = useState(initialInput.startsWith("/"));
  const [selectedIdx, setSelectedIdx] = useState(0);
  const { exit } = useApp();

  const filtered = showPalette ? filterCommands(input, COMMAND_REGISTRY) : [];

  useInput((char, key) => {
    if (key.escape) {
      if (showPalette) {
        setShowPalette(false);
      } else {
        if (input.trim() === "") {
          onExit();
          exit();
        } else {
          setInput("");
          setCursorIdx(0);
        }
      }
      return;
    }

    if (key.return) {
      if (showPalette) {
        const selected = filtered[selectedIdx];
        if (selected) {
          const res = handleSelection(selected);
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
      const selected = filtered[selectedIdx];
      if (selected) {
        const res = handleSelection(selected);
        setInput(res.insertText);
        setCursorIdx(res.insertText.length);
        if (res.submit) {
          // If no args, tab completes. Let's just insert and close.
          setShowPalette(false);
        } else {
          setShowPalette(false);
        }
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
      const nextInput = input.slice(0, cursorIdx) + char + input.slice(cursorIdx);
      setInput(nextInput);
      setCursorIdx((i) => i + char.length);
      
      if (char === "/" && nextInput === "/") {
        setShowPalette(true);
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
  }

  let paletteBox: React.ReactNode = null;
  if (showPalette) {
    const boxLines = box("Commands", lines, {
      width: 48,
      charset: HEAVY,
      color: (s) => chalk.hex(theme.accent)(s),
      titleColor: (s) => chalk.hex(theme.accent)(s),
    });
    
    const separator = HEAVY.ml + HEAVY.h.repeat(48) + HEAVY.mr;
    const footerText = pad(" ↑↓ navigate   Tab complete   Enter select   Esc close", 48);
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
    </Box>
  );
}
