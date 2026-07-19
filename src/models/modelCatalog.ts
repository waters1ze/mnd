// src/models/modelCatalog.ts
import { fetchGroqModels } from "./groqModelDiscovery.js";
import { fetchOllamaModels } from "./ollamaModelDiscovery.js";
import { readModelCache, writeModelCache } from "./modelCache.js";
import { loadConfig } from "../core/config.js";
import type { DiscoveredModel } from "./types.js";

let catalogCache: DiscoveredModel[] | null = null;
let isDiscovering = false;

export async function getModelCatalog(forceRefresh = false): Promise<DiscoveredModel[]> {
  if (catalogCache && !forceRefresh) {
    return catalogCache;
  }

  // Try read from disk cache first if we don't force refresh
  if (!forceRefresh) {
    const diskCache = await readModelCache();
    if (diskCache) {
      catalogCache = diskCache;
      return catalogCache;
    }
  }

  return await refreshCatalog();
}

export async function refreshCatalog(): Promise<DiscoveredModel[]> {
  if (isDiscovering) {
    // If already discovering, just return the current cache or wait? 
    // To keep it simple, return current cache if exists, else empty
    return catalogCache || [];
  }
  
  isDiscovering = true;
  try {
    const cfg = await loadConfig();
    
    // We add local Sidecar Whisper explicitly as it's built-in
    const sidecarModel: DiscoveredModel = {
      id: "whisper-1", // example id
      provider: "sidecar_whisper",
      capabilities: ["transcription"],
      availability: "available",
      displayName: "Local Python Whisper",
      local: true,
      installed: true,
      source: "live",
      discoveredAt: new Date().toISOString()
    };

    const antigravityModels: DiscoveredModel[] = (cfg.connections.antigravity?.cached_models ?? []).map(model => ({
      id: model.id,
      provider: "antigravity" as const,
      capabilities: ["text"],
      availability: "available" as const,
      displayName: model.id,
      local: false,
      installed: true,
      source: "live" as const,
      discoveredAt: new Date().toISOString(),
    }));

    const groqModels = await fetchGroqModels(cfg.connections.groq_api_key_ref);
    const ollamaModels = await fetchOllamaModels(cfg.connections.ollama_host);

    const results = [sidecarModel, ...antigravityModels, ...groqModels, ...ollamaModels];
    
    // Validate current configured models against the results.
    // If a configured model is missing, we append it as "unavailable" or "unknown"
    const ensureConfigured = (modelId: string | undefined | null, provider: "groq"|"ollama") => {
      if (!modelId) return;
      const found = results.find(m => m.id === modelId && m.provider === provider);
      if (!found) {
        results.push({
          id: modelId,
          provider,
          capabilities: [], // We don't know for sure
          availability: provider === "ollama" ? "not_installed" : "unavailable",
          local: provider === "ollama",
          installed: false,
          source: "configured",
          discoveredAt: new Date().toISOString()
        });
      }
    };

    ensureConfigured(cfg.models.hybrid.text.model, "groq");
    ensureConfigured(cfg.models.hybrid.vision.model, "groq");
    ensureConfigured(cfg.models.hybrid.transcription.model, "groq");
    ensureConfigured(cfg.models.local.text.model, "ollama");
    ensureConfigured(cfg.models.local.vision.model, "ollama");

    catalogCache = results;
    await writeModelCache(results);
    return results;
  } finally {
    isDiscovering = false;
  }
}
