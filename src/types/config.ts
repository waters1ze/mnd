// src/types/config.ts

export type ProfileName = "hybrid" | "local";

export interface ModelEntry {
  provider: "groq" | "ollama" | "sidecar_whisper" | "antigravity";
  model?: string;
}

export interface ProfileModels {
  transcription: ModelEntry;
  text: ModelEntry;
  vision: ModelEntry;
  image_gen: ModelEntry;
}

export interface MndConfig {
  version: number;
  profile: ProfileName;
  vault_path: string;
  inbox_path?: string;

  connections: {
    groq_api_key_ref: string;
    antigravity_cli_path: string;
    ollama_host: string;
  };

  models: {
    hybrid: ProfileModels;
    local: ProfileModels;
  };

  export: {
    format: "fcpxml";
    target: "davinci_resolve";
  };

  fallback: {
    auto_switch_to_local_on_groq_failure: boolean;
    max_retries_before_fallback: number;
  };
}

/** Returns the active profile's model config */
export type ActiveProfileModels = ProfileModels;
