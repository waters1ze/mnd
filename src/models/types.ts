// src/models/types.ts

export type ModelProvider = "groq" | "ollama" | "sidecar_whisper" | "antigravity";
export type ModelCapability = "text" | "vision" | "transcription" | "image_generation";
export type Availability = "available" | "unavailable" | "unknown" | "not_installed" | "deprecated";

export interface DiscoveredModel {
  id: string;
  provider: ModelProvider;
  capabilities: ModelCapability[];
  availability: Availability;
  displayName?: string;
  contextWindow?: number;
  sizeBytes?: number;
  local: boolean;
  installed?: boolean;
  deprecated?: boolean;
  source: "live" | "cache" | "curated" | "configured";
  discoveredAt: string;
  metadata?: Record<string, unknown>;
}

export interface ModelCatalogSchema {
  version: number;
  updatedAt: string;
  models: DiscoveredModel[];
}
