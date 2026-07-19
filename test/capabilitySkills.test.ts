import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills } from "../src/core/vault.js";
import {
  parseAntigravityAudit,
  parseCapabilityAssessment,
  saveAntigravitySkill,
} from "../src/pipeline/capabilityOrchestrator.js";

describe("Groq/Antigravity capability skills", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "mnd-capability-skill-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  test("parses hidden capability and audit contracts deterministically", () => {
    expect(parseCapabilityAssessment(JSON.stringify({
      requestedCapabilities: ["video.monochrome"],
      unknownCapabilities: [{ name: "animated-collage", reason: "No matching operation" }],
      summary: "One known and one unknown request",
    }))).toMatchObject({
      requestedCapabilities: ["video.monochrome"],
      unknownCapabilities: [{ name: "animated-collage", reason: "No matching operation" }],
    });
    expect(parseAntigravityAudit(JSON.stringify({
      verdict: "skill_required",
      explanation: "Create a reusable recipe",
      skill: {
        name: "Animated Collage",
        description: "Builds a collage from supported overlays.",
        triggers: ["collage"],
        capabilities: ["image.transcript_overlay"],
        instructions: ["Select the requested source images.", "Place them as connected overlays."],
      },
    }))).toMatchObject({ verdict: "skill_required", skill: { name: "Animated Collage" } });
  });

  test("persists an allowlisted Antigravity recipe and exposes it through listSkills", async () => {
    const proposal = {
      name: "Dialogue Polish",
      description: "Reusable dialogue cleanup and enhancement.",
      triggers: ["clean up my voice", "улучши голос"],
      capabilities: ["audio.gain", "audio.voice_eq", "audio.noise_reduction"],
      instructions: ["Apply voice enhancement EQ.", "Reduce steady background noise.", "Keep dialogue gain below clipping."],
    };
    const saved = await saveAntigravitySkill(vaultPath, proposal);
    expect(saved).toMatchObject({ created: true, status: "active" });
    const duplicate = await saveAntigravitySkill(vaultPath, proposal);
    expect(duplicate).toMatchObject({ created: false, status: "active" });
    const skills = await listSkills(vaultPath);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.frontmatter).toMatchObject({
      id: "dialogue-polish",
      source: "antigravity",
      status: "active",
      type: "prompt",
    });
    expect(skills[0]!.body).toContain("## Instructions");
  });

  test("rejects executable instructions from an AI proposal", async () => {
    await expect(saveAntigravitySkill(vaultPath, {
      name: "Unsafe",
      description: "Unsafe proposal",
      triggers: ["unsafe"],
      capabilities: ["video.monochrome"],
      instructions: ["powershell Remove-Item everything"],
    })).rejects.toThrow("rejected");
  });
});
