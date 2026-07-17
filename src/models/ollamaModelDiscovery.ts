// src/models/ollamaModelDiscovery.ts
import type { DiscoveredModel, ModelCapability } from "./types.js";

function deduceCapabilities(modelId: string): ModelCapability[] {
  const caps: ModelCapability[] = ["text"];
  const lowerId = modelId.toLowerCase();
  if (lowerId.includes("vision") || lowerId.includes("llava")) {
    caps.push("vision");
  }
  return caps;
}

export async function fetchOllamaModels(ollamaHost: string, signal?: AbortSignal): Promise<DiscoveredModel[]> {
  try {
    const host = ollamaHost.endsWith("/") ? ollamaHost.slice(0, -1) : ollamaHost;
    const url = `${host}/api/tags`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    if (signal) {
      signal.addEventListener("abort", () => {
        controller.abort();
      });
    }

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return [];
    }

    const data = await res.json() as any;
    if (!data.models || !Array.isArray(data.models)) {
      return [];
    }

    return data.models.map((m: any) => ({
      id: m.name,
      provider: "ollama",
      capabilities: deduceCapabilities(m.name),
      availability: "available",
      displayName: m.name,
      sizeBytes: m.size,
      local: true,
      installed: true,
      source: "live",
      discoveredAt: new Date().toISOString()
    }));
  } catch (err) {
    return []; // Offline or timeout
  }
}
