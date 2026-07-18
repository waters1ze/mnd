export interface StructuredError {
  ok: false;
  status: "failed" | "action_required" | "cancelled";
  error: { code: string; message: string; details?: unknown };
  suggestedActions?: string[];
}

let jsonMode = process.argv.includes("--json") || process.env["MND_JSON"] === "1";

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function emitResult(value: unknown, human?: string): void {
  if (jsonMode) console.log(JSON.stringify(value));
  else if (human) console.log(human);
}

export function emitProgress(message: string): void {
  if (!jsonMode) console.log(message);
}

export function structuredError(error: unknown): StructuredError {
  const message = error instanceof Error ? error.message : String(error);
  const actionRequired = /(?:required|missing|not configured|does not exist|no project|already exists|offline)/i.test(message);
  return {
    ok: false,
    status: actionRequired ? "action_required" : "failed",
    error: { code: actionRequired ? "ACTION_REQUIRED" : "COMMAND_FAILED", message },
  };
}
