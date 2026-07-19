import { existsSync } from "node:fs";
import { join } from "node:path";
import { groqChatWithFallback, type ChatMessage } from "../core/groqClient.js";
import { runAntigravityPrompt } from "../core/antigravityClient.js";
import { listSkills, slugify, writeFrontmatter } from "../core/vault.js";
import type { SkillFrontmatter, VaultSkill } from "../types/vault.js";

export const MND_CAPABILITIES = [
  { id: "edit.smart_cross_dissolve", description: "Insert handle-safe cross dissolves only at abrupt cuts" },
  { id: "video.monochrome", description: "Render selected clips in black and white" },
  { id: "audio.gain", description: "Adjust dialogue gain from -24 dB to +12 dB" },
  { id: "audio.voice_eq", description: "Apply voice enhance, bass or treble EQ presets" },
  { id: "audio.pitch", description: "Shift dialogue pitch by up to four semitones while preserving duration" },
  { id: "audio.noise_reduction", description: "Apply dialogue noise reduction from 0 to 100" },
  { id: "audio.loudness", description: "Normalize dialogue loudness and uniformity" },
  { id: "image.transcript_overlay", description: "Place a named source image at a matching transcript cue" },
  { id: "publishing.metadata_thumbnail", description: "Generate title, description, tags and a verified thumbnail" },
] as const;

export interface CapabilityAssessment {
  requestedCapabilities: string[];
  unknownCapabilities: Array<{ name: string; reason: string }>;
  summary: string;
}

export interface SkillProposal {
  name: string;
  description: string;
  triggers: string[];
  capabilities: string[];
  instructions: string[];
}

interface AntigravityAudit {
  verdict: "known" | "skill_required";
  explanation: string;
  skill: SkillProposal | null;
}

export interface CapabilityResolution {
  assessment: CapabilityAssessment;
  audit: AntigravityAudit;
  skill?: { name: string; filePath: string; created: boolean; status: "active" | "instruction_only" };
}

function jsonObject(raw: string): Record<string, unknown> {
  const stripped = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Capability response does not contain JSON");
  return JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
}

function strings(value: unknown, maximum = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, maximum);
}

export function parseCapabilityAssessment(raw: string): CapabilityAssessment {
  const value = jsonObject(raw);
  const unknown = Array.isArray(value.unknownCapabilities) ? value.unknownCapabilities.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.reason !== "string") return [];
    return [{ name: record.name.trim().slice(0, 100), reason: record.reason.trim().slice(0, 500) }];
  }).slice(0, 8) : [];
  return {
    requestedCapabilities: strings(value.requestedCapabilities),
    unknownCapabilities: unknown,
    summary: typeof value.summary === "string" ? value.summary.trim().slice(0, 1000) : "",
  };
}

export function parseAntigravityAudit(raw: string): AntigravityAudit {
  const value = jsonObject(raw);
  const verdict = value.verdict === "skill_required" ? "skill_required" : "known";
  let skill: SkillProposal | null = null;
  if (verdict === "skill_required" && value.skill && typeof value.skill === "object") {
    const rawSkill = value.skill as Record<string, unknown>;
    if (typeof rawSkill.name === "string" && typeof rawSkill.description === "string") {
      skill = {
        name: rawSkill.name.trim().slice(0, 80),
        description: rawSkill.description.trim().slice(0, 1000),
        triggers: strings(rawSkill.triggers, 12),
        capabilities: strings(rawSkill.capabilities, 20),
        instructions: strings(rawSkill.instructions, 30),
      };
    }
  }
  return {
    verdict,
    explanation: typeof value.explanation === "string" ? value.explanation.trim().slice(0, 1200) : "",
    skill,
  };
}

export async function saveAntigravitySkill(vaultPath: string, proposal: SkillProposal): Promise<CapabilityResolution["skill"]> {
  if (!proposal.name.trim() || !proposal.description.trim() || proposal.instructions.length === 0) {
    throw new Error("Antigravity skill proposal is incomplete");
  }
  const proposalText = [proposal.name, proposal.description, ...proposal.triggers, ...proposal.instructions];
  const unsafeInstruction = proposalText.find((instruction) =>
    /```|https?:\/\/|(?:^|\s)(?:powershell|cmd\.exe|bash|sh|curl|wget|rm|del|remove-item|invoke-expression)(?:\s|$)|[;&|]{2}/i.test(instruction),
  );
  if (unsafeInstruction) throw new Error("Antigravity skill proposal contained executable or external content and was rejected");
  const id = slugify(proposal.name) || `antigravity-skill-${Date.now()}`;
  const filePath = join(vaultPath, "Skills", `${id}.md`);
  const existing = (await listSkills(vaultPath)).find((skill) => skill.frontmatter.id === id || skill.name === id);
  if (existing) {
    return { name: existing.name, filePath: existing.filePath, created: false, status: existing.frontmatter.status ?? "instruction_only" };
  }
  const known = new Set<string>(MND_CAPABILITIES.map((capability) => capability.id));
  const status = proposal.capabilities.every((capability) => known.has(capability)) ? "active" : "instruction_only";
  const now = new Date().toISOString();
  const frontmatter: SkillFrontmatter = {
    id,
    type: "prompt",
    used_in_styles: [],
    source: "antigravity",
    status,
    capabilities: proposal.capabilities,
    triggers: proposal.triggers,
    created: now,
    updated: now,
  };
  const body = [
    `# ${proposal.name}`,
    "",
    proposal.description,
    "",
    "## Instructions",
    "",
    ...proposal.instructions.map((instruction, index) => `${index + 1}. ${instruction}`),
    "",
    "## Capability mapping",
    "",
    ...proposal.capabilities.map((capability) => `- \`${capability}\``),
    "",
    "> [!INFO]",
    `> Generated by Antigravity after Groq reported an unknown capability. Status: ${status}.`,
    "",
  ].join("\n");
  if (existsSync(filePath)) throw new Error(`Refusing to overwrite existing skill: ${filePath}`);
  await writeFrontmatter(filePath, frontmatter, body);
  return { name: proposal.name, filePath, created: true, status };
}

export async function resolvePromptCapabilities(
  prompt: string,
  vaultPath: string,
  options: { antigravityModel?: string } = {},
): Promise<CapabilityResolution> {
  const currentSkills: VaultSkill[] = await listSkills(vaultPath);
  const capabilityPayload = {
    prompt,
    builtInCapabilities: MND_CAPABILITIES,
    installedSkills: currentSkills.map((skill) => ({
      id: skill.frontmatter.id,
      status: skill.frontmatter.status ?? "instruction_only",
      capabilities: skill.frontmatter.capabilities ?? [],
      instructions: skill.body,
    })),
  };
  const groqSystem = `You are MND's hidden capability classifier. Return one JSON object with requestedCapabilities, unknownCapabilities and summary.
unknownCapabilities is only for an operation that cannot be expressed by the built-in capability catalog or an installed skill. Unfamiliar wording is not an unknown capability. Do not propose code, commands, paths or a skill.`;
  let assessment: CapabilityAssessment;
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: groqSystem },
      { role: "user", content: JSON.stringify(capabilityPayload) },
    ];
    assessment = parseCapabilityAssessment((await groqChatWithFallback(messages, "capability_assessment", true)).result);
  } catch (error) {
    assessment = {
      requestedCapabilities: [],
      unknownCapabilities: [],
      summary: `Groq capability assessment unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const auditSystem = `You are Antigravity, MND's capability auditor. Check every prompt, but return verdict "known" and skill null unless Groq's unknownCapabilities is non-empty.
If Groq reported an unknown capability, provide one reusable declarative MND skill. It may only contain prose instructions and capability IDs; never code, shell commands, file paths, URLs or executable content.
Return one JSON object: {"verdict":"known|skill_required","explanation":"...","skill":null|{"name":"...","description":"...","triggers":["..."],"capabilities":["..."],"instructions":["..."]}}.`;
  const auditPrompt = `${auditSystem}\n\nINPUT:\n${JSON.stringify({ ...capabilityPayload, groqAssessment: assessment })}`;
  const auditOptions = { ...(options.antigravityModel ? { model: options.antigravityModel } : {}), timeoutMs: 180_000, mode: "plan" as const };
  let audit = parseAntigravityAudit(await runAntigravityPrompt(auditPrompt, auditOptions));
  if (assessment.unknownCapabilities.length > 0 && (audit.verdict !== "skill_required" || !audit.skill)) {
    audit = parseAntigravityAudit(await runAntigravityPrompt(
      `${auditPrompt}\n\nCORRECTION: Groq reported unknown capabilities, so verdict must be skill_required and skill must contain a complete safe declarative recipe.`,
      auditOptions,
    ));
  }
  if (assessment.unknownCapabilities.length === 0) {
    return { assessment, audit: { ...audit, verdict: "known", skill: null } };
  }
  if (audit.verdict !== "skill_required" || !audit.skill) throw new Error("Antigravity did not provide the required skill for Groq's unknown capability");
  const skill = await saveAntigravitySkill(vaultPath, audit.skill);
  return { assessment, audit, ...(skill ? { skill } : {}) };
}
