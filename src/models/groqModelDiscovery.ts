// src/models/groqModelDiscovery.ts
import { Groq } from "groq-sdk";
import type { DiscoveredModel, ModelCapability } from "./types.js";
import { secretsGet } from "../core/secrets.js";

function deduceCapabilities(modelId: string): ModelCapability[] {
  const caps: ModelCapability[] = ["text"];
  const lowerId = modelId.toLowerCase();
  if (lowerId.includes("vision") || lowerId.includes("llava")) {
    caps.push("vision");
  }
  if (lowerId.includes("whisper")) {
    caps.push("transcription");
  }
  return caps;
}

export async function fetchGroqModels(apiKeyRef: string, signal?: AbortSignal): Promise<DiscoveredModel[]> {
  try {
    const key = await secretsGet(apiKeyRef);
    if (!key) {
      return []; // No key, offline/unknown
    }

    const groq = new Groq({ apiKey: key });
    
    // We race the API call with the abort signal and a timeout
    const fetchPromise = groq.models.list();
    const timeoutPromise = new Promise<never>((_, reject) => {
      const id = setTimeout(() => reject(new Error("Timeout")), 10000);
      signal?.addEventListener("abort", () => {
        clearTimeout(id);
        reject(new Error("Aborted"));
      });
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);
    
    return response.data.map((m: any) => ({
      id: m.id,
      provider: "groq",
      capabilities: deduceCapabilities(m.id),
      availability: "available",
      displayName: m.id,
      contextWindow: m.context_window,
      local: false,
      installed: false,
      source: "live",
      discoveredAt: new Date().toISOString()
    }));
  } catch (err: any) {
    if (err.message === "Aborted" || err.message === "Timeout") {
      throw err;
    }
    // Rate limit, auth error etc.
    return [];
  }
}
