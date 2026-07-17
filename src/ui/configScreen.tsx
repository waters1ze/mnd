// src/ui/configScreen.tsx
import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import chalk from "chalk";
import { loadConfig, saveConfig, invalidateConfigCache } from "../core/config.js";
import { renderFocusableBox, createFocusTransition } from "./focusFrame.js";
import { theme } from "./theme.js";
import { pad, box, HEAVY } from "./box.js";
import type { MndConfig } from "../types/config.js";
import { isOllamaInstalled, listPulledModels, getInstallInstructions } from "../core/ollamaBootstrap.js";

type SectionName = "profile" | "connections" | "models" | "fallback" | "export";
const SECTIONS: SectionName[] = ["profile", "connections", "models", "fallback", "export"];

interface Option {
  value: string;
  label: string;
}

type ConfigField =
  | { kind: "select"; label: string; options: Option[]; getValue: (c: MndConfig) => string; setValue: (c: MndConfig, v: string) => void; }
  | { kind: "boolean"; label: string; getValue: (c: MndConfig) => string; setValue: (c: MndConfig, v: boolean) => void; }
  | { kind: "number"; label: string; min: number; max: number; getValue: (c: MndConfig) => string; setValue: (c: MndConfig, v: number) => void; }
  | { kind: "text"; label: string; validate?: (v: string) => string | null; getValue: (c: MndConfig) => string; setValue: (c: MndConfig, v: string) => void; }
  | { kind: "model"; label: string; provider: "groq" | "ollama" | "antigravity" | "sidecar_whisper"; getValue: (c: MndConfig) => string; setValue: (c: MndConfig, v: string) => void; };

const SECTION_FIELDS: Record<SectionName, ConfigField[]> = {
  profile: [
    { kind: "select", label: "Profile", options: [{value: "hybrid", label: "hybrid"}, {value: "local", label: "local"}], getValue: c => c.profile, setValue: (c, v) => c.profile = v as any },
    { kind: "text", label: "Vault Path", getValue: c => c.vault_path, setValue: (c, v) => c.vault_path = v },
    { kind: "text", label: "Inbox Path", getValue: c => c.inbox_path ?? "", setValue: (c, v) => c.inbox_path = v },
  ],
  connections: [
    { kind: "text", label: "Groq API Key Ref", getValue: c => c.connections.groq_api_key_ref, setValue: (c, v) => c.connections.groq_api_key_ref = v },
    { kind: "text", label: "Antigravity CLI Path", getValue: c => c.connections.antigravity_cli_path, setValue: (c, v) => c.connections.antigravity_cli_path = v },
    { kind: "text", label: "Ollama Host", getValue: c => c.connections.ollama_host, setValue: (c, v) => c.connections.ollama_host = v },
  ],
  models: [
    { kind: "model", provider: "groq", label: "Hybrid Text Model", getValue: c => c.models.hybrid.text.model ?? "", setValue: (c, v) => c.models.hybrid.text.model = v },
    { kind: "model", provider: "groq", label: "Hybrid Transcription Model", getValue: c => c.models.hybrid.transcription.model ?? "", setValue: (c, v) => c.models.hybrid.transcription.model = v },
    { kind: "model", provider: "groq", label: "Hybrid Vision Model", getValue: c => c.models.hybrid.vision.model ?? "", setValue: (c, v) => c.models.hybrid.vision.model = v },
    { kind: "model", provider: "ollama", label: "Local Text Model", getValue: c => c.models.local.text.model ?? "", setValue: (c, v) => c.models.local.text.model = v },
    { kind: "model", provider: "ollama", label: "Local Vision Model", getValue: c => c.models.local.vision.model ?? "", setValue: (c, v) => c.models.local.vision.model = v },
  ],
  fallback: [
    { kind: "boolean", label: "Auto Switch to Local", getValue: c => String(c.fallback.auto_switch_to_local_on_groq_failure), setValue: (c, v) => c.fallback.auto_switch_to_local_on_groq_failure = v },
    { kind: "number", min: 0, max: 10, label: "Max Retries Before Fallback", getValue: c => String(c.fallback.max_retries_before_fallback), setValue: (c, v) => c.fallback.max_retries_before_fallback = v },
  ],
  export: [
    { kind: "select", label: "Export Format", options: [{value: "fcpxml", label: "fcpxml"}], getValue: c => c.export.format, setValue: (c, v) => c.export.format = v as "fcpxml" },
    { kind: "select", label: "Target", options: [{value: "davinci_resolve", label: "davinci_resolve"}], getValue: c => c.export.target, setValue: (c, v) => c.export.target = v as "davinci_resolve" },
  ]
};

export function ConfigScreen(): React.ReactElement {
  const [focusSection, setFocusSection] = useState<SectionName>("profile");
  const [focusFieldIdx, setFocusFieldIdx] = useState(0);
  const [transition, setTransition] = useState<"snapping" | "settled">("settled");
  
  const [editing, setEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState("");
  const [editError, setEditError] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [optionIdx, setOptionIdx] = useState(0);
  
  const [cfg, setCfg] = useState<MndConfig | null>(null);
  const { exit } = useApp();

  useEffect(() => {
    loadConfig().then(setCfg).catch(console.error);
  }, []);

  useInput(async (input, key) => {
    if (!cfg) return;

    const fields = SECTION_FIELDS[focusSection];
    const field = fields[focusFieldIdx];
    if (!field) return;

    if (editing) {
      if (key.escape) {
        setEditing(false);
        setEditError("");
        return;
      }

      if (field.kind === "select" || field.kind === "boolean" || field.kind === "model") {
        if (key.upArrow) {
          setOptionIdx(i => Math.max(0, i - 1));
        } else if (key.downArrow) {
          setOptionIdx(i => Math.min(options.length - 1, i + 1));
        } else if (key.return) {
          const selected = options[optionIdx];
          if (selected) {
            const newCfg = structuredClone(cfg);
            if (field.kind === "boolean") {
              field.setValue(newCfg, selected.value === "true");
            } else {
              field.setValue(newCfg, selected.value);
            }
            await saveConfig(newCfg);
            invalidateConfigCache();
            setCfg(newCfg);
            setEditing(false);
          }
        }
        return;
      }

      // Text and Number editing
      if (key.return) {
        if (field.kind === "number") {
          const parsed = parseInt(editBuffer, 10);
          if (isNaN(parsed) || parsed < field.min || parsed > field.max) {
            setEditError(`Must be integer between ${field.min} and ${field.max}`);
            return;
          }
          const newCfg = structuredClone(cfg);
          field.setValue(newCfg, parsed);
          await saveConfig(newCfg);
          invalidateConfigCache();
          setCfg(newCfg);
          setEditing(false);
          setEditError("");
        } else if (field.kind === "text") {
          if (field.validate) {
            const err = field.validate(editBuffer);
            if (err) {
              setEditError(err);
              return;
            }
          }
          const newCfg = structuredClone(cfg);
          field.setValue(newCfg, editBuffer);
          await saveConfig(newCfg);
          invalidateConfigCache();
          setCfg(newCfg);
          setEditing(false);
          setEditError("");
        }
      } else if (key.backspace || key.delete) {
        setEditBuffer(b => b.slice(0, -1));
        setEditError("");
      } else if (input && !key.ctrl && !key.meta) {
        setEditBuffer(b => b + input);
        setEditError("");
      }
      return;
    }

    if (key.escape) { exit(); return; }

    if (key.tab || key.leftArrow || key.rightArrow) {
      const idx = SECTIONS.indexOf(focusSection);
      let dir = (key.tab && key.shift) || key.leftArrow ? -1 : 1;
      const next = SECTIONS[(idx + dir + SECTIONS.length) % SECTIONS.length]!;
      setFocusSection(next);
      setFocusFieldIdx(0);
      createFocusTransition(setTransition);
      return;
    }

    if (key.upArrow) {
      setFocusFieldIdx(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setFocusFieldIdx(i => Math.min(fields.length - 1, i + 1));
    } else if (key.return) {
      setEditBuffer(field.getValue(cfg));
      setEditError("");
      
      if (field.kind === "select") {
        setOptions(field.options);
        setOptionIdx(Math.max(0, field.options.findIndex(o => o.value === field.getValue(cfg))));
        setEditing(true);
      } else if (field.kind === "boolean") {
        setOptions([{value: "true", label: "Enabled"}, {value: "false", label: "Disabled"}]);
        setOptionIdx(field.getValue(cfg) === "true" ? 0 : 1);
        setEditing(true);
      } else if (field.kind === "model") {
        setOptions([{value: field.getValue(cfg), label: `Current: ${field.getValue(cfg)}`}]);
        setOptionIdx(0);
        setEditing(true);
        // Load dynamically
        if (field.provider === "ollama") {
          listPulledModels().then(models => {
            const opts = models.map(m => ({value: m, label: m}));
            if (opts.length === 0) opts.push({value: "", label: "No local models found"});
            opts.push({value: field.getValue(cfg), label: "Custom model ID..."});
            setOptions(opts);
          });
        }
      } else {
        setEditing(true);
      }
    }
  });

  if (!cfg) return <Text color="gray">Loading config...</Text>;

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={theme.accent}>┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓</Text>
      <Text bold color={theme.accent}>┃ MND  /  CONFIGURATION                               ┃</Text>
      <Text bold color={theme.accent}>┃ {pad(`Profile: ${cfg.profile.toUpperCase()}   Vault: ${cfg.vault_path}`, 52)} ┃</Text>
      <Text bold color={theme.accent}>┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛</Text>
      <Text color="gray">←/→/Tab switch section  ↑↓ navigate  Enter edit  Esc close</Text>
      <Box flexDirection="column" marginTop={1}>
        {SECTIONS.map((section) => {
          const isFocused = section === focusSection;
          const fields = SECTION_FIELDS[section];
          const lines = fields.map((f, i) => {
            const val = f.getValue(cfg);
            const isCurrent = isFocused && i === focusFieldIdx;
            const prefix = isCurrent ? (editing ? "✏ " : "▸ ") : "  ";
            
            if (editing && isCurrent) {
              if (f.kind === "select" || f.kind === "boolean" || f.kind === "model") {
                const optStr = options.map((o, idx) => idx === optionIdx ? chalk.bgHex(theme.accent).black(` ${o.label} `) : ` ${o.label} `).join(" | ");
                return `${prefix}${f.label}: ${optStr}`;
              } else {
                return `${prefix}${f.label}: ${editBuffer}█ ${editError ? chalk.red(`(${editError})`) : ""}`;
              }
            } else {
              return `${prefix}${f.label}: ${val}`;
            }
          });

          const rendered = renderFocusableBox(
            section.charAt(0).toUpperCase() + section.slice(1),
            lines,
            {
              focused: isFocused,
              width: 70,
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
