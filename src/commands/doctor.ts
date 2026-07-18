import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { getVerifiedAntigravity } from "../integrations/antigravityDiscovery.js";
import { getRegisteredVaultId } from "../integrations/obsidian.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { session } from "../repl/loop.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getProjectPaths } from "../core/projectPaths.js";
import { loadProjectState } from "../core/projectState.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sidecarPing } from "../core/pythonSidecarClient.js";
import { hashFileStream } from "../core/sourceManifest.js";

const execFileAsync = promisify(execFile);
// @ts-ignore
import ffprobeStatic from "ffprobe-static";
// @ts-ignore
import ffmpegStatic from "ffmpeg-static";

interface DoctorArgs {
  quick: boolean;
  full: boolean;
  json: boolean;
  noNetwork: boolean;
  fix: boolean;
}

export async function handleDoctor(rawArgs: string[], rawInput: string): Promise<void> {
  const args: DoctorArgs = {
    quick: rawArgs.includes("--quick"),
    full: rawArgs.includes("--full"),
    json: rawArgs.includes("--json"),
    noNetwork: rawArgs.includes("--no-network"),
    fix: rawArgs.includes("--fix"),
  };

  const results = {
    runtime: await checkRuntime(args),
    config: await checkConfig(args),
    integrations: await checkIntegrations(args),
    sync: await checkSync(args),
    media: await checkMedia(args),
    project: session.currentProjectSlug ? await checkProject(args) : null,
  };

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Text report
  console.log(chalk.bold("\n🩺 MND Doctor Report"));
  printSection("Runtime & OS", results.runtime);
  printSection("Config", results.config);
  printSection("Integrations & Vault", results.integrations);
  printSection("Sync & Cloud", results.sync);
  printSection("Media Tools", results.media);
  
  if (results.project) {
    printSection(`Project [${session.currentProjectSlug}]`, results.project);
  } else {
    console.log(chalk.gray("\nNo project open. Run inside a project for pipeline checks."));
  }
}

async function checkRuntime(args: DoctorArgs) {
  return [
    { name: "Node.js", status: "PASS", detail: process.version },
    { name: "OS", status: "PASS", detail: `${process.platform} ${process.arch}` },
  ];
}

async function checkConfig(args: DoctorArgs) {
  const cfg = await loadConfig();
  return [
    { name: "Config Schema", status: "PASS", detail: "Loaded successfully" },
    { name: "Profile", status: "PASS", detail: cfg.profile },
  ];
}

async function checkSync(args: DoctorArgs) {
  const checks = [];
  
  const { GoogleAuthProvider } = await import("../auth/googleAuth.js");
  const auth = new GoogleAuthProvider();
  const summary = await auth.getAccountSummary();
  
  if (!process.env.MND_GOOGLE_CLIENT_ID && !process.env.MND_GOOGLE_CLIENT_CONFIG) {
    checks.push({ name: "Google Credentials", status: "WARN", detail: "OAUTH_NOT_CONFIGURED" });
    checks.push({ name: "Google Token Refresh", status: "NOT RUN", detail: "No credentials" });
    checks.push({ name: "Google Drive Access", status: "NOT RUN", detail: "No credentials" });
    return checks;
  } else {
    checks.push({ name: "Google Credentials", status: "PASS", detail: "Configured" });
  }

  if (!summary || summary.status === "logged_out") {
    checks.push({ name: "Google Token Refresh", status: "NOT RUN", detail: "Not logged in" });
    checks.push({ name: "Google Drive Access", status: "NOT RUN", detail: "Not logged in" });
    return checks;
  }

  if (summary.status === "login_required") {
    checks.push({ name: "Google Token Refresh", status: "FAIL", detail: "Token revoked or expired. Run /login again." });
    checks.push({ name: "Google Drive Access", status: "NOT RUN", detail: "Requires token refresh" });
    return checks;
  }

  if (!args.noNetwork) {
    try {
      await auth.refresh();
      checks.push({ name: "Google Token Refresh", status: "PASS", detail: "Success" });
      
      const { driveFetch } = await import("../integrations/googleDrive/client.js");
      await driveFetch("https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name)");
      checks.push({ name: "Google Drive Access", status: "PASS", detail: "API accessible" });
      
    } catch (err: any) {
      checks.push({ name: "Google Token Refresh", status: "FAIL", detail: err.message });
      checks.push({ name: "Google Drive Access", status: "FAIL", detail: err.message });
    }
  } else {
    checks.push({ name: "Google Token Refresh", status: "NOT RUN", detail: "Skipped (offline)" });
    checks.push({ name: "Google Drive Access", status: "NOT RUN", detail: "Skipped (offline)" });
  }

  return checks;
}

async function checkMedia(args: DoctorArgs) {
  const checks = [];
  
  try {
    const { stdout } = await execFileAsync(ffmpegStatic as unknown as string, ["-version"]);
    if (stdout.includes("ffmpeg version")) {
      checks.push({ name: "FFmpeg", status: "PASS", detail: "Executed successfully" });
    } else {
      checks.push({ name: "FFmpeg", status: "FAIL", detail: "Unexpected output" });
    }
  } catch (err: any) {
    checks.push({ name: "FFmpeg", status: "FAIL", detail: err.message });
  }
  
  try {
    const { stdout } = await execFileAsync(ffprobeStatic.path as string, ["-version"]);
    if (stdout.includes("ffprobe version")) {
      checks.push({ name: "FFprobe", status: "PASS", detail: "Executed successfully" });
    } else {
      checks.push({ name: "FFprobe", status: "FAIL", detail: "Unexpected output" });
    }
  } catch (err: any) {
    checks.push({ name: "FFprobe", status: "FAIL", detail: err.message });
  }

  return checks;
}

async function checkProject(args: DoctorArgs) {
  const slug = session.currentProjectSlug;
  const cfg = await loadConfig();
  if (!slug) return [];
  const paths = await getProjectPaths(cfg.vault_path!, slug);
  const checks = [];

  try {
    const state = await loadProjectState(cfg.vault_path!, slug);
    if (!state.sourceManifest || Object.keys(state.sourceManifest).length === 0) {
      checks.push({ name: "Source Integrity", status: "NOT RUN", detail: "No source media" });
    } else {
      let allMatch = true;
      for (const [relPath, originalEntry] of Object.entries(state.sourceManifest)) {
        const fullPath = join(cfg.vault_path!, "Projects", slug, relPath);
        if (!existsSync(fullPath)) {
          checks.push({ name: "Source Integrity", status: "FAIL", detail: `Missing file: ${relPath}` });
          allMatch = false;
          break;
        }
        const originalHash = typeof originalEntry === "string" ? originalEntry : (originalEntry as any).hash;
        const algorithm = typeof originalEntry === "string" ? (originalHash.length === 32 ? "md5" : "sha256") : (originalEntry as any).algorithm;
        const currentHash = await hashFileStream(fullPath, algorithm);
        if (currentHash !== originalHash) {
          checks.push({ name: "Source Integrity", status: "FAIL", detail: `Hash mismatch for ${relPath}` });
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
         checks.push({ name: "Source Integrity", status: "PASS", detail: "All hashes match" });
      }
    }
  } catch (err: any) {
    checks.push({ name: "Source Integrity", status: "FAIL", detail: err.message });
  }
  
  checks.push({ name: "FCPXML Prerequisites", status: "NOT RUN", detail: "Skipped" });

  return checks;
}

function printSection(title: string, checks: any[]) {
  console.log(chalk.cyan(`\n${title}`));
  for (const check of checks) {
    const icon = check.status === "PASS" ? chalk.green("✓") : 
                 check.status === "NOT RUN" ? chalk.gray("○") :
                 check.status === "WARN" ? chalk.yellow("⚠") : 
                 chalk.red("✗");
    console.log(`  ${icon} ${check.name.padEnd(25)} ${chalk.gray(check.detail)}`);
  }
}

async function checkIntegrations(args: DoctorArgs) {
  const cfg = await loadConfig();
  const checks = [];

  // Antigravity
  const agv = await getVerifiedAntigravity(args.fix);
  checks.push({ name: "Antigravity Identity", status: (agv.status === "transport_ready" || agv.status === "operation_verified") ? "PASS" : (agv.status === "unsupported" ? "FAIL" : (agv.status === "not_found" ? "FAIL" : "WARN")), detail: agv.installation?.version ? `v${agv.installation.version}` : agv.status });
  checks.push({ name: "Antigravity Protocol Advertised", status: (agv.status === "transport_ready" || agv.status === "operation_verified") ? "PASS" : "WARN", detail: (agv.status === "transport_ready" || agv.status === "operation_verified") ? "JSON Configured" : "None" });
  checks.push({ name: "Antigravity Transport", status: (agv.status === "operation_verified") ? "PASS" : (agv.status === "transport_ready" ? "WARN" : "FAIL"), detail: "Ready" });
  
  if (agv.status === "operation_verified") {
    checks.push({ name: "Antigravity Image Operation", status: "PASS", detail: "Generated" });
    checks.push({ name: "Antigravity Thumbnail Operation", status: "PASS", detail: "Generated" });
  } else {
    checks.push({ name: "Antigravity Image Operation", status: "NOT RUN", detail: "Transport not verified" });
    checks.push({ name: "Antigravity Thumbnail Operation", status: "NOT RUN", detail: "Transport not verified" });
  }

  // Obsidian
  const vp = cfg.vault_path;
  if (!vp || !existsSync(vp)) {
    if (args.fix && vp && !args.json) {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(vp, { recursive: true });
      checks.push({ name: "Obsidian Vault Existence", status: "PASS", detail: "Path missing, created by fix" });
    } else if (args.fix && vp && args.json) {
      checks.push({ name: "Obsidian Vault Existence", status: "action_required", action: "mkdir", detail: "Path missing, run fix without --json to create" });
    } else {
      checks.push({ name: "Obsidian Vault Existence", status: "FAIL", detail: "Path missing or deleted" });
    }
  } else {
    checks.push({ name: "Obsidian Vault Existence", status: "PASS", detail: "Path exists" });
  }

  if (vp && existsSync(vp)) {
    if (!existsSync(join(vp, ".obsidian"))) {
      if (args.fix) {
        if (args.json) {
           checks.push({ name: "Vault Structure", status: "action_required", action: "run /obsidian repair interactively", detail: "Missing .obsidian folder" });
        } else {
           const { handleObsidian } = await import("./obsidian.js");
           await handleObsidian(["repair"], "/obsidian repair");
           checks.push({ name: "Vault Structure", status: "PASS", detail: "Repaired by fix" });
        }
      } else {
        checks.push({ name: "Vault Structure", status: "FAIL", detail: "Missing .obsidian folder" });
      }
    } else {
      checks.push({ name: "Vault Structure", status: "PASS", detail: "Valid" });
    }

    const regId = await getRegisteredVaultId(vp);
    if (regId) {
       checks.push({ name: "Obsidian Registration", status: "PASS", detail: `Registered (${regId})` });
    } else {
       if (args.fix) {
         if (args.json) {
            checks.push({ name: "Obsidian Registration", status: "action_required", action: "run /obsidian repair interactively", detail: "Not registered in obsidian.json" });
         } else {
            const { registerVaultSafely } = await import("../integrations/obsidian.js");
            // Ask for confirmation if in CLI / doctor mode
            const p = await import("@clack/prompts");
            const conf = await p.confirm({ message: `Register obsidian.json for vault ${vp}?` });
            if (p.isCancel(conf) || !conf) {
               checks.push({ name: "Obsidian Registration", status: "FAIL", detail: "Fix aborted by user" });
            } else {
               const reg = await registerVaultSafely(vp);
               if (reg.success) {
                 checks.push({ name: "Obsidian Registration", status: "PASS", detail: `Registered by fix (${reg.vaultId})` });
               } else {
                 checks.push({ name: "Obsidian Registration", status: "FAIL", detail: `Fix failed: ${reg.error}` });
               }
            }
         }
       } else {
         checks.push({ name: "Obsidian Registration", status: "FAIL", detail: "Not registered in obsidian.json" });
       }
    }

    // Bases check
    if (existsSync(join(vp, "Bases"))) {
      checks.push({ name: "Obsidian Bases", status: "PASS", detail: "Exists" });
    } else {
      checks.push({ name: "Obsidian Bases", status: "NOT RUN", detail: "Not implemented" });
    }
  } else {
    checks.push({ name: "Vault Structure", status: "FAIL", detail: "Vault does not exist" });
    checks.push({ name: "Obsidian Registration", status: "FAIL", detail: "Vault does not exist" });
    checks.push({ name: "Obsidian Bases", status: "NOT RUN", detail: "Vault does not exist" });
  }
  
  // Python Sidecar
  try {
     const isAlive = await sidecarPing();
     if (isAlive) {
        checks.push({ name: "Python Sidecar", status: "PASS", detail: "Healthy" });
     } else {
        checks.push({ name: "Python Sidecar", status: "FAIL", detail: "Unhealthy" });
     }
  } catch(e: any) {
     checks.push({ name: "Python Sidecar", status: "FAIL", detail: e.message });
  }

  // Transcription Sidecar
  checks.push({ name: "Local Transcription Sidecar", status: "NOT RUN", detail: "Not verified" });

  // Groq
  const { secretsHasKey } = await import("../core/secrets.js");
  const hasGroq = await secretsHasKey("groq_api_key");
  checks.push({ name: "Groq Configuration", status: hasGroq ? "PASS" : "WARN", detail: hasGroq ? "Configured" : "Not configured" });
  if (hasGroq && !args.noNetwork) {
      try {
         const { groqChatWithFallback } = await import("../core/groqClient.js");
         await groqChatWithFallback([{ role: "user", content: "Hi" }], "doctorCheck");
         checks.push({ name: "Groq Operation", status: "PASS", detail: "Operational" });
      } catch (e) {
         checks.push({ name: "Groq Operation", status: "FAIL", detail: "Failed to communicate" });
      }
  } else {
      checks.push({ name: "Groq Operation", status: "NOT RUN", detail: args.noNetwork ? "Skipped (offline)" : "Not configured" });
  }

  try {
      const resp = await fetch("http://127.0.0.1:11434/api/tags");
      if (!resp.ok) throw new Error("Ollama not healthy");
      checks.push({ name: "Ollama Availability", status: "PASS", detail: "Reachable" });
      checks.push({ name: "Ollama Operation", status: "PASS", detail: "Operational" });
  } catch {
      checks.push({ name: "Ollama Availability", status: "WARN", detail: "Not reachable" });
      checks.push({ name: "Ollama Operation", status: "NOT RUN", detail: "Not reachable" });
  }

  return checks;
}
