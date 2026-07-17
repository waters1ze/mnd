// src/ui/configScreen.tsx
// ink full-screen config editor — 5 sections, each a FocusableBox
import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { renderFocusableBox, createFocusTransition } from "./focusFrame.js";
import { loadConfig, saveConfig, invalidateConfigCache } from "../core/config.js";
import { getSecretsStore } from "../core/secrets.js";
import { theme } from "./theme.js";
import type { MndConfig } from "../types/config.js";

type SectionName = "profile" | "connections" | "models" | "fallback" | "export";
const SECTIONS: SectionName[] = ["profile", "connections", "models", "fallback", "export"];

interface FieldEdit {
  section: SectionName;
  fieldIdx: number;
  value: string;
}

interface SectionField {
  label: string;
  getValue: (cfg: MndConfig) => string;
  setValue: (cfg: MndConfig, v: string) => void;
  secret?: boolean; // for API keys
}

const SECTION_FIELDS: Record<SectionName, SectionField[]> = {
  profile: [
    {
      label: "Profile",
      getValue: (c) => c.profile,
      setValue: (c, v) => { c.profile = v as "hybrid" | "local"; },
    },
    {
      label: "Vault Path",
      getValue: (c) => c.vault_path,
      setValue: (c, v) => { c.vault_path = v; },
    },
    {
      label: "Inbox Path",
      getValue: (c) => c.inbox_path ?? "",
      setValue: (c, v) => { c.inbox_path = v; },
    },
  ],
  connections: [
    {
      label: "Groq API Key Ref",
      getValue: (c) => c.connections.groq_api_key_ref,
      setValue: (c, v) => { c.connections.groq_api_key_ref = v; },
    },
    {
      label: "Antigravity CLI Path",
      getValue: (c) => c.connections.antigravity_cli_path,
      setValue: (c, v) => { c.connections.antigravity_cli_path = v; },
    },
    {
      label: "Ollama Host",
      getValue: (c) => c.connections.ollama_host,
      setValue: (c, v) => { c.connections.ollama_host = v; },
    },
  ],
  models: [
    {
      label: "Hybrid Text Model",
      getValue: (c) => c.models.hybrid.text.model ?? "",
      setValue: (c, v) => { c.models.hybrid.text.model = v; },
    },
    {
      label: "Hybrid Transcription Model",
      getValue: (c) => c.models.hybrid.transcription.model ?? "",
      setValue: (c, v) => { c.models.hybrid.transcription.model = v; },
    },
    {
      label: "Hybrid Vision Model",
      getValue: (c) => c.models.hybrid.vision.model ?? "",
      setValue: (c, v) => { c.models.hybrid.vision.model = v; },
    },
    {
      label: "Local Text Model",
      getValue: (c) => c.models.local.text.model ?? "",
      setValue: (c, v) => { c.models.local.text.model = v; },
    },
  ],
  fallback: [
    {
      label: "Auto Switch to Local",
      getValue: (c) => String(c.fallback.auto_switch_to_local_on_groq_failure),
      setValue: (c, v) => { c.fallback.auto_switch_to_local_on_groq_failure = v === "true"; },
    },
    {
      label: "Max Retries Before Fallback",
      getValue: (c) => String(c.fallback.max_retries_before_fallback),
      setValue: (c, v) => { c.fallback.max_retries_before_fallback = parseInt(v, 10); },
    },
  ],
  export: [
    {
      label: "Export Format",
      getValue: (c) => c.export.format,
      setValue: (c, v) => { c.export.format = v as "fcpxml"; },
    },
    {
      label: "Target",
      getValue: (c) => c.export.target,
      setValue: (c, v) => { c.export.target = v as "davinci_resolve"; },
    },
  ],
};

export function ConfigScreen(): React.ReactElement {
  const [focusSection, setFocusSection] = useState<SectionName>("profile");
  const [focusFieldIdx, setFocusFieldIdx] = useState(0);
  const [transition, setTransition] = useState<"snapping" | "settled">("settled");
  const [editing, setEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState("");
  const [cfg, setCfg] = useState<MndConfig | null>(null);
  const { exit } = useApp();

  // Load config on mount
  React.useEffect(() => {
    loadConfig().then(setCfg).catch(console.error);
  }, []);

  useInput(async (input, key) => {
    if (!cfg) return;

    if (editing) {
      if (key.return) {
        // Save field
        const fields = SECTION_FIELDS[focusSection];
        const field = fields[focusFieldIdx];
        if (field) {
          const newCfg = structuredClone(cfg);
          field.setValue(newCfg, editBuffer);
          await saveConfig(newCfg);
          invalidateConfigCache();
          setCfg(newCfg);
        }
        setEditing(false);
      } else if (key.escape) {
        setEditing(false);
      } else if (key.backspace || key.delete) {
        setEditBuffer((b) => b.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setEditBuffer((b) => b + input);
      }
      return;
    }

    if (key.escape) { exit(); return; }

    if (key.tab) {
      const idx = SECTIONS.indexOf(focusSection);
      const next = SECTIONS[(idx + 1) % SECTIONS.length]!;
      setFocusSection(next);
      setFocusFieldIdx(0);
      createFocusTransition(setTransition);
      return;
    }

    if (key.upArrow) {
      setFocusFieldIdx((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      const fields = SECTION_FIELDS[focusSection];
      setFocusFieldIdx((i) => Math.min(fields.length - 1, i + 1));
    } else if (key.return) {
      const fields = SECTION_FIELDS[focusSection];
      const field = fields[focusFieldIdx];
      if (field) {
        setEditBuffer(field.getValue(cfg));
        setEditing(true);
      }
    }
  });

  if (!cfg) {
    return <Text color="gray">Loading config...</Text>;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={theme.accent}>⚙ mnd Configuration</Text>
      <Text color="gray">Tab=next section  ↑↓=navigate  Enter=edit  Esc=close</Text>
      <Box flexDirection="column" marginTop={1}>
        {SECTIONS.map((section) => {
          const isFocused = section === focusSection;
          const fields = SECTION_FIELDS[section];
          const lines = fields.map((f, i) => {
            const val = f.getValue(cfg);
            const isCurrent = isFocused && i === focusFieldIdx;
            const prefix = isCurrent ? (editing ? "✏ " : "▸ ") : "  ";
            const valDisplay = editing && isCurrent ? editBuffer + "█" : val;
            return `${prefix}${f.label}: ${valDisplay}`;
          });

          const rendered = renderFocusableBox(
            section.charAt(0).toUpperCase() + section.slice(1),
            lines,
            {
              focused: isFocused,
              width: 54,
              focusTransition: isFocused ? transition : "settled",
            }
          );

          return (
            <Box key={section} flexDirection="column" marginBottom={1}>
              {rendered.map((line, i) => (
                <Text key={i}>{line}</Text>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
