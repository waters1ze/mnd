// src/ui/configScreen.tsx
import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import chalk from "chalk";
import { loadConfig, saveConfig, invalidateConfigCache } from "../core/config.js";
import { renderFocusableBox, createFocusTransition } from "./focusFrame.js";
import { theme } from "./theme.js";
import { pad, HEAVY } from "./box.js";
import type { MndConfig } from "../types/config.js";
import { getModelCatalog } from "../models/modelCatalog.js";
import type { DiscoveredModel } from "../models/types.js";
import { OllamaPullProgress } from "./OllamaPullProgress.js";
import { getVerifiedAntigravity, discoverAntigravityCli, type AntigravityDiscoveryResult } from "../integrations/antigravityDiscovery.js";

type SectionName = "profile" | "connections" | "models" | "fallback" | "export";
const SECTIONS: SectionName[] = ["profile", "connections", "models", "fallback", "export"];

interface Option {
  value: string;
  label: string;
  availability?: string;
  local?: boolean;
}

type ConfigField =
  | { kind: "select"; label: string; options: Option[]; getValue: (c: MndConfig) => string; setValue: (c: MndConfig, v: string) => void; }
  | { kind: "boolean"; label: string; getValue: (c: MndConfig) => string; setValue: (c: MndConfig, v: boolean) => void; }
  | { kind: "number"; label: string; min: number; max: number; getValue: (c: MndConfig) => string; setValue: (c: MndConfig, v: number) => void; }
  | { kind: "text"; label: string; validate?: (v: string) => string | null; getValue: (c: MndConfig) => string; setValue: (c: MndConfig, v: string) => void; }
  | { kind: "model"; label: string; provider: "groq" | "ollama" | "antigravity" | "sidecar_whisper"; getValue: (c: MndConfig) => string; setValue: (c: MndConfig, v: string) => void; }
  | { kind: "antigravity"; label: string; }
  | { kind: "action"; label: string; render: (c: MndConfig) => string[]; onAction?: (action: string) => void; };

const SECTION_FIELDS: Record<SectionName, ConfigField[]> = {
  profile: [
    { kind: "select", label: "Profile", options: [{value: "hybrid", label: "hybrid"}, {value: "local", label: "local"}], getValue: c => c.profile, setValue: (c, v) => c.profile = v as any },
    { kind: "text", label: "Vault Path", getValue: c => c.vault_path, setValue: (c, v) => c.vault_path = v },
    { kind: "text", label: "Inbox Path", getValue: c => c.inbox_path ?? "", setValue: (c, v) => c.inbox_path = v },
  ],
  connections: [
    { kind: "text", label: "Groq API Key Ref", getValue: c => c.connections.groq_api_key_ref, setValue: (c, v) => c.connections.groq_api_key_ref = v },
    { kind: "text", label: "Ollama Host", getValue: c => c.connections.ollama_host, setValue: (c, v) => c.connections.ollama_host = v },
    { kind: "antigravity", label: "Antigravity Status" },
  ],
  models: [
    { kind: "model", provider: "antigravity", label: "Antigravity Conversation Model", getValue: c => c.models.hybrid.text.model ?? "", setValue: (c, v) => { c.models.hybrid.text.provider = "antigravity"; c.models.hybrid.text.model = v; } },
    { kind: "model", provider: "groq", label: "Hybrid Transcription Model", getValue: c => c.models.hybrid.transcription.model ?? "", setValue: (c, v) => c.models.hybrid.transcription.model = v },
    { kind: "model", provider: "groq", label: "Hybrid Vision Model", getValue: c => c.models.hybrid.vision.model ?? "", setValue: (c, v) => c.models.hybrid.vision.model = v },
    { kind: "model", provider: "ollama", label: "Local Text Model", getValue: c => c.models.local.text.model ?? "", setValue: (c, v) => c.models.local.text.model = v },
    { kind: "model", provider: "sidecar_whisper", label: "Local Transcription", getValue: c => c.models.local.transcription?.model ?? "", setValue: (c, v) => { if(c.models.local.transcription) c.models.local.transcription.model = v; } },
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

  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [customModelMode, setCustomModelMode] = useState<boolean>(false);
  
  const [cfg, setCfg] = useState<MndConfig | null>(null);
  const [agvStatus, setAgvStatus] = useState<AntigravityDiscoveryResult | null>(null);
  const [agvScanning, setAgvScanning] = useState(false);
  const { exit } = useApp();

  useEffect(() => {
    loadConfig().then(setCfg).catch(console.error);
    getVerifiedAntigravity().then(setAgvStatus).catch(console.error);
  }, []);

  const saveFieldValue = async (val: any) => {
    if (!cfg) return;
    const field = SECTION_FIELDS[focusSection][focusFieldIdx];
    if (!field || field.kind === "antigravity" || field.kind === "action") return;
    const newCfg = structuredClone(cfg);
    field.setValue(newCfg, val as never);
    await saveConfig(newCfg);
    invalidateConfigCache();
    setCfg(newCfg);
    setEditing(false);
    setEditError("");
  };

  useInput(async (input, key) => {
    if (!cfg || pullingModel) return;

    const fields = SECTION_FIELDS[focusSection];
    const field = fields[focusFieldIdx];
    if (!field) return;

    if (customModelMode) {
      if (key.escape) {
        setCustomModelMode(false);
        setEditing(false);
        setEditError("");
        return;
      }
      if (key.return) {
        if (editBuffer.trim() === "") {
          setEditError("Cannot be empty");
          return;
        }
        await saveFieldValue(editBuffer.trim());
        setCustomModelMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setEditBuffer(b => b.slice(0, -1));
        setEditError("");
      } else if (input && !key.ctrl && !key.meta) {
        setEditBuffer(b => b + input);
        setEditError("");
      }
      return;
    }

    if (editing) {
      if (key.escape) {
        setEditing(false);
        setEditError("");
        return;
      }

      if (field.kind === "select" || field.kind === "boolean" || field.kind === "model" || field.kind === "antigravity") {
        if (key.upArrow) {
          setOptionIdx(i => Math.max(0, i - 1));
        } else if (key.downArrow) {
          setOptionIdx(i => Math.min(options.length - 1, i + 1));
        } else if (key.return) {
          const selected = options[optionIdx];
          if (selected) {
            if (selected.value === "__custom__") {
              setEditBuffer("");
              setCustomModelMode(true);
              return;
            }
            if (selected.availability === "not_installed" && selected.local) {
              setPullingModel(selected.value);
              return;
            }
            if (field.kind === "antigravity") {
              setEditing(false); // just close diagnostics
              return;
            }
            let val: any = selected.value;
            if (field.kind === "boolean") val = selected.value === "true";
            await saveFieldValue(val);
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
          await saveFieldValue(parsed);
        } else if (field.kind === "text") {
          if (field.validate) {
            const err = field.validate(editBuffer);
            if (err) {
              setEditError(err);
              return;
            }
          }
          await saveFieldValue(editBuffer);
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
    } else if (field.kind === "antigravity") {
      if (!agvScanning) {
        if (input === "r" || input === "R") {
          setAgvScanning(true);
          discoverAntigravityCli().then(res => {
             setAgvStatus(res);
             setAgvScanning(false);
          }).catch(() => setAgvScanning(false));
        } else if (input === "d" || input === "D") {
          // Diagnostics
          setOptions(agvStatus?.checkedCandidates.map(c => ({ value: c.path, label: `${c.path} [${c.source}] - ${c.result}` })) || [{ value: "", label: "No candidates checked" }]);
          setOptionIdx(0);
          setEditing(true);
        }
      }
      return;
    }
    if (key.return) {
      setEditBuffer((field.kind !== "antigravity" && field.kind !== "action") ? field.getValue(cfg) : "");
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
        const cur = field.getValue(cfg);
        
        if (field.provider === "antigravity") {
          let opts: Option[] = [];
          if (agvStatus?.status === "operation_verified" || agvStatus?.status === "transport_ready") {
             opts.push({ value: "", label: "Auto / Antigravity default", availability: "available", local: true });
             if (agvStatus.installation?.models && agvStatus.installation.models.length > 0) {
               agvStatus.installation.models.forEach(m => opts.push({ value: m.id, label: m.id, availability: "available", local: true }));
             }
          } else {
             opts.push({ value: "", label: "Antigravity not verified", availability: "unavailable", local: true });
          }
          if (!opts.find(o => o.value === cur) && cur) {
             opts.push({ value: cur, label: `${cur} (unverified)`, availability: "unknown", local: true });
          }
          if (agvStatus?.status === "operation_verified" || agvStatus?.status === "transport_ready") {
             if (agvStatus.installation?.models && agvStatus.installation.models.length > 0) {
                 opts.push({value: "__custom__", label: "Custom model ID..."});
             }
          }
          setOptions(opts);
          const currentIdx = opts.findIndex(o => o.value === cur);
          setOptionIdx(currentIdx >= 0 ? currentIdx : 0);
          setEditing(true);
        } else {
          setOptions([{value: cur, label: "Loading catalog..."}]);
          setOptionIdx(0);
          setEditing(true);

          getModelCatalog(false).then(models => {
            const providerModels = models.filter(m => m.provider === field.provider);
            let opts: Option[] = providerModels.map(m => ({
              value: m.id,
              label: m.displayName || m.id,
              availability: m.availability,
              local: m.local
            }));
            
            if (!opts.find(o => o.value === cur) && cur) {
              opts.unshift({ value: cur, label: cur, availability: "unknown", local: field.provider === "ollama" });
            }
            if (opts.length === 0) opts.push({value: "", label: "No models found"});
            opts.push({value: "__custom__", label: "Custom model ID..."});

            setOptions(opts);
            const currentIdx = opts.findIndex(o => o.value === cur);
            setOptionIdx(currentIdx >= 0 ? currentIdx : 0);
          });
        }
      } else {
        setEditing(true);
      }
    }
  });

  if (!cfg) return <Text color="gray">Loading config...</Text>;

  if (pullingModel) {
    return (
      <OllamaPullProgress 
        model={pullingModel}
        host={cfg.connections.ollama_host}
        onSuccess={() => {
          // Re-query catalog after install
          getModelCatalog(true).then(() => {
            saveFieldValue(pullingModel);
            setPullingModel(null);
          });
        }}
        onCancel={() => {
          setPullingModel(null);
          setEditing(false); // cancel edit
        }}
      />
    );
  }

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
            const val = (f.kind !== "antigravity" && f.kind !== "action") ? f.getValue(cfg) : "";
            const isCurrent = isFocused && i === focusFieldIdx;
            const prefix = isCurrent ? (editing ? "✏ " : "▸ ") : "  ";
            
            if (editing && isCurrent) {
              if (customModelMode) {
                return `${prefix}${f.label}: ${editBuffer}█ ${editError ? chalk.red(`(${editError})`) : ""}`;
              } else if (f.kind === "model") {
                return `${prefix}${f.label}:`;
              } else if (f.kind === "select" || f.kind === "boolean" || f.kind === "antigravity") {
                const optLines = options.map((o, idx) => idx === optionIdx ? chalk.bgHex(theme.accent).black(`    > ${o.label} `) : `      ${o.label} `);
                return [`${prefix}${f.label}:`, ...optLines].join("\n");
              } else {
                return `${prefix}${f.label}: ${editBuffer}█ ${editError ? chalk.red(`(${editError})`) : ""}`;
              }
            } else {
              if (f.kind === "antigravity") {
                if (agvScanning) return `${prefix}Antigravity: detecting...`;
                if (!agvStatus) return `${prefix}Antigravity: Loading...`;
                let st = agvStatus.status;
                if (st === "operation_verified" || st === "transport_ready") return [
                  `${prefix}Antigravity: ${st === "operation_verified" ? "✓ Verified" : "⚠ Started"}`,
                  `      Version: ${agvStatus.installation?.version || "unknown"}`,
                  `      Location: ${agvStatus.installation?.executablePath}`,
                  `      [Enter] Select model  [R] Rescan  [D] Diagnostics`
                ].join("\n");
                if (st === "unsupported") return [
                  `${prefix}Antigravity: ✗ Application found but CLI protocol unavailable`,
                  `      [R] Rescan  [D] Diagnostics`
                ].join("\n");
                return [
                  `${prefix}Antigravity: ✗ Not found`,
                  `      [R] Rescan  [D] Diagnostics`
                ].join("\n");
              }
              return `${prefix}${f.label}: ${val}`;
            }
          });

          // Insert vertical options if model field is editing
          if (editing && isFocused && SECTION_FIELDS[section][focusFieldIdx]?.kind === "model" && !customModelMode) {
            // we insert lines into the lines array directly below the current field
            const insertAt = focusFieldIdx + 1;
            const maxOptions = 6;
            const startIdx = Math.max(0, Math.min(optionIdx - 2, options.length - maxOptions));
            const endIdx = Math.min(options.length, startIdx + maxOptions);
            
            const optionLines = options.slice(startIdx, endIdx).map((o, visibleIdx) => {
              const actualIdx = startIdx + visibleIdx;
              const isSelected = actualIdx === optionIdx;
              let label = o.label;
              if (o.availability === "unavailable") label += chalk.red(" (unavailable)");
              if (o.availability === "not_installed") label += chalk.yellow(" (not installed)");
              if (o.availability === "unknown") label += chalk.gray(" (unknown)");
              return isSelected ? chalk.bgHex(theme.accent).black(`    > ${o.value} `) : `      ${label}`;
            });

            if (startIdx > 0) optionLines.unshift("      ...");
            if (endIdx < options.length) optionLines.push("      ...");

            lines.splice(insertAt, 0, ...optionLines);
          }

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
