import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";
import { spawn, type ChildProcess } from "node:child_process";
import { registerProcess, unregisterProcess } from "../core/cancellation.js";

export type PullState =
  | { status: "idle" }
  | { status: "confirming"; model: string }
  | { status: "pulling"; model: string; percent?: number; message?: string }
  | { status: "success"; model: string }
  | { status: "cancelled"; model: string }
  | { status: "error"; model: string; message: string };

interface Props {
  model: string;
  host: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function OllamaPullProgress({ model, host, onSuccess, onCancel }: Props): React.ReactElement {
  const [state, setState] = useState<PullState>({ status: "confirming", model });
  const [cp, setCp] = useState<ChildProcess | null>(null);

  useEffect(() => {
    return () => {
      if (cp && !cp.killed) {
        cp.kill();
        if (cp.pid) unregisterProcess(cp.pid);
      }
    };
  }, [cp]);

  useInput((input, key) => {
    if (state.status === "confirming") {
      if (key.return) {
        startPull();
      } else if (key.escape || (input.toLowerCase() === 'n')) {
        onCancel();
      }
    } else if (state.status === "pulling") {
      if (key.escape) {
        if (cp && !cp.killed) {
          cp.kill();
        }
        setState({ status: "cancelled", model });
        setTimeout(onCancel, 1000);
      }
    } else if (state.status === "success" || state.status === "error" || state.status === "cancelled") {
      if (key.return || key.escape) {
        if (state.status === "success") {
          onSuccess();
        } else {
          onCancel();
        }
      }
    }
  });

  function startPull() {
    setState({ status: "pulling", model, message: "starting pull..." });
    const env = { ...process.env, OLLAMA_HOST: host };
    const child = spawn("ollama", ["pull", model], { env, stdio: ["ignore", "pipe", "pipe"] });
    setCp(child);
    
    if (child.pid) {
      registerProcess({
        pid: child.pid,
        kind: "python", // 'python' is just a placeholder here, or we can add 'ollama' to the type if we want, but it just needs to be a valid TrackedProcess
        process: child,
        ownedByRun: true
      });
    }

    let lastUpdate = Date.now();
    child.stdout.on("data", (chunk: Buffer) => {
      const now = Date.now();
      if (now - lastUpdate < 100) return; // throttle updates
      lastUpdate = now;

      const lines = chunk.toString().split("\n");
      const lastLine = lines[lines.length - 2] || lines[lines.length - 1] || "";
      if (lastLine) {
        setState(prev => prev.status === "pulling" ? { ...prev, message: lastLine } : prev);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const now = Date.now();
      if (now - lastUpdate < 100) return;
      lastUpdate = now;
      const msg = chunk.toString().trim();
      if (msg) setState(prev => prev.status === "pulling" ? { ...prev, message: msg } : prev);
    });

    child.on("close", (code) => {
      if (child.pid) unregisterProcess(child.pid);
      if (code === 0) {
        setState({ status: "success", model });
        setTimeout(onSuccess, 1000);
      } else {
        setState(prev => {
          if (prev.status === "cancelled") return prev;
          return { status: "error", model, message: `Exited with code ${code}` };
        });
      }
    });
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">Install local model</Text>
      <Text>{model}</Text>
      <Box marginTop={1}>
        {state.status === "confirming" && (
          <Text>Model is not installed. Pull now? (Enter=yes, Esc=no)</Text>
        )}
        {state.status === "pulling" && (
          <Text color="yellow">⠹ {state.message || "Downloading..."}</Text>
        )}
        {state.status === "success" && (
          <Text color="green">✔ Installed successfully.</Text>
        )}
        {state.status === "error" && (
          <Text color="red">✗ Error: {state.message}</Text>
        )}
        {state.status === "cancelled" && (
          <Text color="gray">Cancelled.</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Esc to cancel</Text>
      </Box>
    </Box>
  );
}
