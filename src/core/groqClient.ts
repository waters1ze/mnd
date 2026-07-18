// src/core/groqClient.ts
import chalk from "chalk";
import { loadConfig, getActiveProfile } from "./config.js";
import { getSecretsStore } from "./secrets.js";
import { withLog } from "./runLog.js";
import { createReadStream } from "node:fs";
import { Groq } from "groq-sdk";
import { getAbortController } from "./cancellation.js";

const GROQ_BASE = "https://api.groq.com/openai/v1";

async function getApiKey(): Promise<string> {
  const cfg = await loadConfig();
  const secrets = await getSecretsStore();
  const key = await secrets.get(cfg.connections.groq_api_key_ref);
  if (!key) {
    throw new Error(
      `Groq API key not set. Run \`config\` → Connections → Set API key (ref: ${cfg.connections.groq_api_key_ref})`
    );
  }
  return key;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number
): Promise<Response> {
  const delays = [500, 1000, 2000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, options);
      if (resp.ok) return resp;
      const body = await resp.text();
      lastErr = new Error(`Groq HTTP ${resp.status}: ${body}`);
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(delays[attempt] ?? 2000);
          continue;
        }
      }
      throw lastErr;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) await sleep(delays[attempt] ?? 2000);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
}

export interface ChatResponse {
  choices: Array<{ message: { content: string } }>;
}

export async function groqChat(
  messages: ChatMessage[],
  step = "chat",
  jsonMode = false
): Promise<string> {
  const profile = await getActiveProfile();
  const model = profile.text.model ?? "llama-3.3-70b-versatile";
  const cfg = await loadConfig();
  const maxRetries = cfg.fallback.max_retries_before_fallback;

  return withLog(step, "groq", model, async () => {
    const apiKey = await getApiKey();
    const body: Record<string, unknown> = {
      model,
      messages,
    };
    if (jsonMode) {
      body["response_format"] = { type: "json_object" };
    }
    const resp = await fetchWithRetry(
      `${GROQ_BASE}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      maxRetries
    );
    const data = (await resp.json()) as ChatResponse;
    return data.choices[0]?.message.content ?? "";
  });
}

export async function groqVisionChat(
  messages: ChatMessage[],
  step = "vision"
): Promise<string> {
  const profile = await getActiveProfile();
  const model = profile.vision.model ?? "llama-3.2-90b-vision-preview";
  const cfg = await loadConfig();
  const maxRetries = cfg.fallback.max_retries_before_fallback;

  return withLog(step, "groq", model, async () => {
    const apiKey = await getApiKey();
    const resp = await fetchWithRetry(
      `${GROQ_BASE}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages }),
      },
      maxRetries
    );
    const data = (await resp.json()) as ChatResponse;
    return data.choices[0]?.message.content ?? "";
  });
}

export interface DetailedTranscription {
  text: string;
  language?: string;
  segments: Array<{ start: number; end: number; text: string; avg_logprob?: number; speaker?: string }>;
  words: Array<{ start: number; end: number; word: string; probability?: number; speaker?: string }>;
}

export async function groqTranscribeDetailed(audioPath: string): Promise<DetailedTranscription> {
  const profile = await getActiveProfile();
  const model = profile.transcription.model ?? "whisper-large-v3";
  const cfg = await loadConfig();
  const maxRetries = cfg.fallback.max_retries_before_fallback;

  return withLog("transcribe_segments", "groq", model, async () => {
    const apiKey = await getApiKey();
    const client = new Groq({ apiKey, maxRetries });
    const response = await client.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model,
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
      temperature: 0,
    }, { signal: getAbortController().signal });
    const data = response as unknown as DetailedTranscription;
    return {
      text: data.text ?? "",
      ...(data.language ? { language: data.language } : {}),
      segments: Array.isArray(data.segments) ? data.segments : [],
      words: Array.isArray(data.words) ? data.words : [],
    };
  });
}

export async function groqTranscribe(audioPath: string): Promise<string> {
  return (await groqTranscribeDetailed(audioPath)).text;
}

/** Transcribe returning timestamped segments */
export async function groqTranscribeSegments(audioPath: string): Promise<Array<{ start: number; end: number; text: string }>> {
  return (await groqTranscribeDetailed(audioPath)).segments;
}

/**
 * Calls Groq with fallback to Ollama on failure.
 * Returns { result, usedFallback }
 */
export async function groqChatWithFallback(
  messages: ChatMessage[],
  step = "chat",
  jsonMode = false
): Promise<{ result: string; usedFallback: boolean }> {
  const cfg = await loadConfig();
  if (!cfg.fallback.auto_switch_to_local_on_groq_failure) {
    return { result: await groqChat(messages, step, jsonMode), usedFallback: false };
  }

  try {
    const result = await groqChat(messages, step, jsonMode);
    return { result, usedFallback: false };
  } catch (err) {
    console.warn(chalk.yellow(`⚠ Groq failed (${step}), falling back to local Ollama: ${err instanceof Error ? err.message : err}`));
    const { ollamaChat } = await import("./ollamaClient.js");
    const result = await ollamaChat(messages, step);
    return { result, usedFallback: true };
  }
}
