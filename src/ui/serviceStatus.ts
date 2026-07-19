import type { AntigravityVerificationStage } from "../integrations/antigravityDiscovery.js";

export function antigravityStatusLabel(
  scanning: boolean,
  status?: AntigravityVerificationStage
): string {
  if (scanning || !status) return "Initializing...";
  if (status === "operation_verified" || status === "transport_ready") return "✓ Ready";
  if (status === "unsupported") return "✗ CLI protocol unavailable";
  if (status === "error") return "✗ Connection failed";
  return "✗ Not found";
}

export function looksLikeApiSecret(value: string): boolean {
  return /^(?:gsk_|sk-)[A-Za-z0-9_-]{12,}$/.test(value.trim());
}

export function safeConfigDisplayValue(value: string): string {
  return looksLikeApiSecret(value) ? "•••••••• (secret hidden; use a key reference)" : value;
}
