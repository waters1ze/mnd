// src/core/pricingTable.ts
// Update these constants when provider prices change

export const PRICING = {
  groq: {
    /** USD per minute of audio (Whisper) */
    whisper_per_minute: 0.0002,
    /** USD per 1 000 input tokens */
    llama_70b_per_1k_input: 0.00059,
    /** USD per 1 000 output tokens */
    llama_70b_per_1k_output: 0.00079,
    /** USD per 1 000 input tokens (vision) */
    llama_vision_per_1k_input: 0.00027,
    /** USD per 1 000 output tokens (vision) */
    llama_vision_per_1k_output: 0.00027,
  },
  /** Tokens per second of audio (rough estimate for cost projection) */
  audio_tokens_per_second: 0.4,
  /** Average tokens per video second for context (rough estimate) */
  context_tokens_per_second: 30,
} as const;
