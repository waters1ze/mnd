// src/ui/setupWizard.tsx
import React, { useState } from "react";
import { Box, Text, useInput, useApp, render } from "ink";
import chalk from "chalk";
import { homedir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "../core/config.js";
import { getSecretsStore } from "../core/secrets.js";
import { theme } from "./theme.js";
import { box, HEAVY, pad } from "./box.js";
import {
  isOllamaInstalled,
  listPulledModels,
  pullModel,
  getInstallInstructions,
  REQUIRED_LOCAL_MODELS,
} from "../core/ollamaBootstrap.js";
import { startTimeProgress, stopProgress } from "./progressBar.js";

// ─── Step Logic State Machine ──────────────────────────────────────────────────

export class SetupWizardLogic {
  step: "welcome" | "groq_key" | "profile" | "bootstrap" | "confirm" | "done" = "welcome";
  vaultPath: string;
  groqKey = "";
  profile: "hybrid" | "local" = "hybrid";
  errorMessage = "";
  ollamaStatus: "unknown" | "installed" | "missing" | "skipped" = "unknown";

  constructor(defaultVault: string) {
    this.vaultPath = defaultVault;
  }

  setVaultPath(p: string): void {
    this.vaultPath = p.trim() || this.vaultPath;
  }

  async submitGroqKey(key: string, validator: (k: string) => Promise<boolean>): Promise<boolean> {
    this.errorMessage = "";
    if (!key.trim()) {
      this.errorMessage = "API key cannot be empty.";
      return false;
    }
    const isValid = await validator(key);
    if (!isValid) {
      this.errorMessage = "Invalid Groq API key. Please verify and try again.";
      return false;
    }
    this.groqKey = key;
    this.step = "profile";
    return true;
  }

  selectProfile(prof: "hybrid" | "local"): void {
    this.profile = prof;
    this.step = "bootstrap";
  }

  confirmSetup(): void {
    this.step = "done";
  }
}

// ─── Ink Components ────────────────────────────────────────────────────────────

interface WelcomeStepProps {
  defaultPath: string;
  onNext: (path: string) => void;
}

function WelcomeStep({ defaultPath, onNext }: WelcomeStepProps): React.ReactElement {
  const [val, setVal] = useState("");

  useInput((input, key) => {
    if (key.return) {
      onNext(val || defaultPath);
    } else if (key.backspace) {
      setVal((v) => v.slice(0, -1));
    } else if (input && input.length === 1) {
      setVal((v) => v + input);
    }
  });

  const contentLines = [
    "Welcome to mnd — AI-assisted vlog editor CLI!",
    "",
    "Please specify the path to your mnd vault directory.",
    "The vault stores your rules, style profiles, and projects.",
    "",
    `Default path: ${chalk.cyan(defaultPath)}`,
    "",
    `Vault Path: ${val || chalk.gray("press Enter to accept default")}`,
  ];

  const boxLines = box("Welcome to mnd", contentLines, {
    width: 48,
    charset: HEAVY,
    color: (s) => chalk.hex(theme.accent)(s),
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      {boxLines.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
      <Text color="gray"> Press Enter to continue</Text>
    </Box>
  );
}

interface GroqKeyProps {
  onSubmit: (key: string) => void;
  error?: string;
  isValidating: boolean;
}

function GroqKeyStep({ onSubmit, error, isValidating }: GroqKeyProps): React.ReactElement {
  const [keyInput, setKeyInput] = useState("");

  useInput((input, key) => {
    if (isValidating) return;
    if (key.return) {
      onSubmit(keyInput);
    } else if (key.backspace) {
      setKeyInput((k) => k.slice(0, -1));
    } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
      setKeyInput((k) => k + input);
    }
  });

  const contentLines = [
    "To use mnd cloud capabilities (transcription & planning),",
    "please enter your Groq API Key.",
    "",
    `Key: ${keyInput ? "•".repeat(keyInput.length) : chalk.gray("paste your key here")}`,
  ];

  if (isValidating) {
    contentLines.push("", chalk.yellow("⣋ Validating API key with Groq..."));
  } else if (error) {
    contentLines.push("", chalk.red(`✗ ${error}`));
  }

  const boxLines = box("Groq API Key Setup", contentLines, {
    width: 48,
    charset: HEAVY,
    color: (s) => chalk.hex(theme.accent)(s),
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      {boxLines.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
      <Text color="gray"> Paste/type key and press Enter to validate</Text>
    </Box>
  );
}

interface ProfileProps {
  onSelect: (prof: "hybrid" | "local") => void;
}

function ProfileStep({ onSelect }: ProfileProps): React.ReactElement {
  const [selected, setSelected] = useState<"hybrid" | "local">("hybrid");

  useInput((input, key) => {
    if (key.upArrow || key.downArrow) {
      setSelected((s) => (s === "hybrid" ? "local" : "hybrid"));
    } else if (key.return) {
      onSelect(selected);
    }
  });

  const contentLines = [
    "Choose your operational profile:",
    "",
    `${selected === "hybrid" ? "▸" : " "} [hybrid] Cloud (Groq) primary, local fallback`,
    "  - Tradeoff: High quality, fast, requires internet connection.",
    "",
    `${selected === "local" ? "▸" : " "} [local] Fully offline, Ollama only`,
    "  - Tradeoff: 100% private and offline, requires local GPU/RAM.",
  ];

  const boxLines = box("Select operational profile", contentLines, {
    width: 48,
    charset: HEAVY,
    color: (s) => chalk.hex(theme.accent)(s),
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      {boxLines.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
      <Text color="gray"> ↑↓ select operational profile  Enter choose</Text>
    </Box>
  );
}

interface BootstrapProps {
  instructions: string;
  onRetry: () => void;
  onSkip: () => void;
}

function BootstrapStep({ instructions, onRetry, onSkip }: BootstrapProps): React.ReactElement {
  useInput((input) => {
    const char = input.toLowerCase();
    if (char === "r") {
      onRetry();
    } else if (char === "s") {
      onSkip();
    }
  });

  const contentLines = [
    chalk.red("Ollama is not detected on your machine!"),
    "",
    "Installation instructions:",
    instructions,
    "",
    "Ollama is needed for local model fallback (hybrid profile)",
    "or fully local execution (local profile).",
  ];

  const boxLines = box("Ollama Detection Failed", contentLines, {
    width: 48,
    charset: HEAVY,
    color: (s) => chalk.hex(theme.accent)(s),
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      {boxLines.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
      <Text color="gray"> [R] Retry detection   [S] Skip local fallback (use cloud-only)</Text>
    </Box>
  );
}

interface ConfirmProps {
  vaultPath: string;
  profile: string;
  hasLocalOllama: boolean;
  onConfirm: () => void;
}

function ConfirmStep({ vaultPath, profile, hasLocalOllama, onConfirm }: ConfirmProps): React.ReactElement {
  useInput((input, key) => {
    if (key.return) {
      onConfirm();
    }
  });

  const contentLines = [
    "Ready to finalize configuration:",
    "",
    `Vault Path : ${chalk.cyan(vaultPath)}`,
    `Profile    : ${chalk.green(profile)}`,
    `Ollama     : ${hasLocalOllama ? chalk.green("Connected") : chalk.yellow("Cloud-Only (Ollama Skipped)")}`,
    "",
    "Press Enter to save config and start mnd CLI...",
  ];

  const boxLines = box("Setup Summary", contentLines, {
    width: 48,
    charset: HEAVY,
    color: (s) => chalk.hex(theme.accent)(s),
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      {boxLines.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
      <Text color="gray"> Press Enter to complete setup</Text>
    </Box>
  );
}

// ─── Groq API validator ────────────────────────────────────────────────────────

async function defaultGroqValidator(key: string): Promise<boolean> {
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Wizard Orchestrator (End-to-End) ──────────────────────────────────────────

type WizardStateValue = "welcome" | "groq_key" | "profile" | "bootstrap" | "confirm" | "done";

export async function runSetupWizard(validator = defaultGroqValidator): Promise<void> {
  const defaultVault = join(homedir(), "Vaults", "mnd");
  const logic = new SetupWizardLogic(defaultVault);

  const wizardState = {
    value: "welcome" as WizardStateValue,
  };

  let validationError = "";
  let isValidatingKey = false;
  let hasLocalOllama = false;

  const runStepUI = (): Promise<void> => {
    return new Promise((resolve) => {
      const Component = () => {
        const { exit } = useApp();

        if (wizardState.value === "welcome") {
          return (
            <WelcomeStep
              defaultPath={defaultVault}
              onNext={(p) => {
                logic.setVaultPath(p);
                wizardState.value = "groq_key";
                exit();
                resolve();
              }}
            />
          );
        }

        if (wizardState.value === "groq_key") {
          return (
            <GroqKeyStep
              isValidating={isValidatingKey}
              error={validationError}
              onSubmit={async (key) => {
                isValidatingKey = true;
                validationError = "";
                const ok = await logic.submitGroqKey(key, validator);
                isValidatingKey = false;
                if (ok) {
                  wizardState.value = "profile";
                } else {
                  validationError = logic.errorMessage;
                }
                exit();
                resolve();
              }}
            />
          );
        }

        if (wizardState.value === "profile") {
          return (
            <ProfileStep
              onSelect={(p) => {
                logic.selectProfile(p);
                wizardState.value = "bootstrap";
                exit();
                resolve();
              }}
            />
          );
        }

        if (wizardState.value === "bootstrap") {
          return (
            <BootstrapStep
              instructions={getInstallInstructions(process.platform)}
              onRetry={() => {
                exit();
                resolve();
              }}
              onSkip={() => {
                logic.ollamaStatus = "skipped";
                wizardState.value = "confirm";
                exit();
                resolve();
              }}
            />
          );
        }

        // confirm setup
        return (
          <ConfirmStep
            vaultPath={logic.vaultPath}
            profile={logic.profile}
            hasLocalOllama={hasLocalOllama}
            onConfirm={() => {
              logic.confirmSetup();
              wizardState.value = "done";
              exit();
              resolve();
            }}
          />
        );
      };

      render(<Component />);
    });
  };

  // 1. Welcome Step
  await runStepUI();

  // 2. Groq Key Step (loops until key is valid or empty-canceled)
  while (wizardState.value === "groq_key") {
    await runStepUI();
  }

  // 3. Profile Step
  await runStepUI();

  // 4. Ollama bootstrap step
  while (wizardState.value === "bootstrap") {
    const installed = await isOllamaInstalled();
    if (installed) {
      hasLocalOllama = true;
      logic.ollamaStatus = "installed";
      // Perform pulling of models outside Ink to prevent rendering conflicts
      const pulled = await listPulledModels();
      const required = [REQUIRED_LOCAL_MODELS.text, REQUIRED_LOCAL_MODELS.vision];

      let spinnerIndex = 0;
      const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

      for (const model of required) {
        if (!pulled.includes(model)) {
          let hasBarStarted = false;
          let bar: any = null;

          const pullRes = await pullModel(model, (percent, rawLine) => {
            if (!isNaN(percent)) {
              if (!hasBarStarted) {
                bar = startTimeProgress(`Pulling ${model}`, 100);
                hasBarStarted = true;
              }
              bar.update(percent);
            } else {
              if (hasBarStarted) {
                stopProgress();
                hasBarStarted = false;
              }
              const spin = spinnerFrames[spinnerIndex++ % spinnerFrames.length];
              process.stdout.write(`\r${chalk.hex(theme.accent)(spin)} Pulling ${model}: ${rawLine.trim()}...      `);
            }
          });

          if (hasBarStarted) {
            stopProgress();
          } else {
            process.stdout.write("\n");
          }

          if (!pullRes.ok) {
            console.log(chalk.red(`\nError pulling local model ${model}: ${pullRes.error}`));
          }
        }
      }
      wizardState.value = "confirm";
      break;
    } else {
      // Ollama not installed, show setup instructions (BootstrapStep)
      await runStepUI();
    }
  }

  // 5. Final Confirmation Step
  if (wizardState.value === "confirm") {
    await runStepUI();
  }

  // Write configuration & secrets
  if (wizardState.value === "done") {
    const store = await getSecretsStore();
    await store.set("groq_api_key", logic.groqKey);

    // Save final configuration properties
    const mndConfig = {
      profile: logic.profile,
      vault_path: logic.vaultPath,
      inbox_path: join(homedir(), "Desktop", "mnd-inbox"),
      connections: {
        groq_api_key_ref: "groq_api_key",
        antigravity_cli_path: process.platform === "win32" ? "antigravity" : "/usr/local/bin/antigravity",
        ollama_host: "http://localhost:11434",
      },
      models: {
        hybrid: {
          transcription: { provider: "groq", model: "whisper-large-v3" },
          text: { provider: "groq", model: "llama-3.3-70b-versatile" },
          vision: { provider: "groq", model: "llama-3.2-90b-vision-preview" },
          image_gen: { provider: "antigravity" },
        },
        local: {
          transcription: { provider: "sidecar_whisper", model: "medium" },
          text: { provider: "ollama", model: "llama3.1:8b" },
          vision: { provider: "ollama", model: "llava:7b" },
          image_gen: { provider: "antigravity" },
        },
      },
      export: {
        format: "fcpxml",
        target: "davinci_resolve",
      },
      fallback: {
        auto_switch_to_local_on_groq_failure: true,
        max_retries_before_fallback: 3,
      },
    };
    await saveConfig(mndConfig as any);
    console.log(chalk.green("\n✓ Setup completed successfully config.yaml written."));
  }
}
