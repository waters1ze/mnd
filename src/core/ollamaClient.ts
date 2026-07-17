// src/core/ollamaClient.ts
import { getActiveProfile, loadConfig } from "./config.js";
import { withLog } from "./runLog.js";
import type { ChatMessage } from "./groqClient.js";

interface OllamaChatResponse {
  message: { content: string };
}

export async function ollamaChat(
  messages: ChatMessage[],
  step = "ollama_chat"
): Promise<string> {
  const cfg = await loadConfig();
  const profile = await getActiveProfile();
  const model = profile.text.model ?? "llama3.1:8b";
  const host = cfg.connections.ollama_host;

  return withLog(step, "ollama", model, async () => {
    const resp = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Ollama error ${resp.status}: ${text}`);
    }

    const data = (await resp.json()) as OllamaChatResponse;
    return data.message.content;
  });
}

export async function ollamaVisionChat(
  messages: ChatMessage[],
  step = "ollama_vision"
): Promise<string> {
  const cfg = await loadConfig();
  const profile = await getActiveProfile();
  const model = profile.vision.model ?? "llava:7b";
  const host = cfg.connections.ollama_host;

  return withLog(step, "ollama", model, async () => {
    const resp = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
    });

    if (!resp.ok) {
      throw new Error(`Ollama vision error ${resp.status}: ${await resp.text()}`);
    }

    const data = (await resp.json()) as OllamaChatResponse;
    return data.message.content;
  });
}

export async function ollamaCheck(host: string): Promise<boolean> {
  try {
    const resp = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch {
    return false;
  }
}
