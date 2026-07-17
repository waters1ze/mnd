// src/ui/selectorWithPreview.tsx
// ink component: list (left) + preview (right) + Tab focus
import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { renderFocusableBox, createFocusTransition } from "./focusFrame.js";
import { theme } from "./theme.js";

export interface SelectorItem {
  label: string;
  preview: string;
}

interface Props {
  title: string;
  items: SelectorItem[];
  onSelect: (label: string) => void;
  onCancel: () => void;
}

export function SelectorWithPreview({ title, items, onSelect, onCancel }: Props): React.ReactElement {
  const [focus, setFocus] = useState<"list" | "preview">("list");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [transition, setTransition] = useState<"snapping" | "settled">("settled");
  const { exit } = useApp();

  const selectedItem = items[selectedIdx];

  useInput((input, key) => {
    if (key.escape) { onCancel(); exit(); return; }

    if (key.tab) {
      setFocus((f) => f === "list" ? "preview" : "list");
      createFocusTransition(setTransition);
      return;
    }

    if (focus === "list") {
      if (key.upArrow) {
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedIdx((i) => Math.min(items.length - 1, i + 1));
      } else if (key.return && selectedItem) {
        onSelect(selectedItem.label);
        exit();
      }
    }
  });

  // List panel
  const listLines = items.map((item, i) => {
    const marker = i === selectedIdx ? `▸ ${item.label}` : `  ${item.label}`;
    return marker;
  });

  const listBox = renderFocusableBox(title, listLines, {
    focused: focus === "list",
    width: 30,
    focusTransition: focus === "list" ? transition : "settled",
  });

  // Preview panel
  const previewContent = selectedItem?.preview ?? "";
  const previewLines = previewContent
    .split("\n")
    .slice(0, 20)
    .map((l) => l.slice(0, 48));

  const previewBox = renderFocusableBox("Preview", previewLines, {
    focused: focus === "preview",
    width: 52,
    focusTransition: focus === "preview" ? transition : "settled",
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Box flexDirection="column">
          {listBox.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
        <Box flexDirection="column">
          {previewBox.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
      </Box>
      <Text color="gray">
        {" "}↑↓ navigate  Tab switch panel  Enter select  Esc cancel
      </Text>
    </Box>
  );
}
