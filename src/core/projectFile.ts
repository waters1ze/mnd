import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { EditProfile, ProjectFileV1 } from "../types/production.js";
import { getProjectPaths } from "./projectPaths.js";
import { atomicWriteFile } from "./atomic.js";
import { readFrontmatter } from "./vault.js";
import type { ProjectFrontmatter } from "../types/vault.js";

const EDIT_PROFILES = new Set<EditProfile>([
  "vlog", "talking_head", "tutorial", "interview", "short_vertical",
  "documentary", "cinematic", "custom",
]);

function validateProjectFile(value: unknown, path: string): ProjectFileV1 {
  if (!value || typeof value !== "object") throw new Error(`Invalid project file: ${path}`);
  const project = value as Partial<ProjectFileV1>;
  if (project.schemaVersion !== 1 || typeof project.id !== "string" || !project.id) {
    throw new Error(`Unsupported project schema: ${path}`);
  }
  if (typeof project.slug !== "string" || typeof project.name !== "string") {
    throw new Error(`Invalid project identity: ${path}`);
  }
  if (!project.editProfile || !EDIT_PROFILES.has(project.editProfile)) {
    throw new Error(`Invalid edit profile in ${path}`);
  }
  return project as ProjectFileV1;
}

export async function loadProjectFile(vaultPath: string, slug: string): Promise<ProjectFileV1> {
  const paths = getProjectPaths(vaultPath, slug);
  if (existsSync(paths.projectJson)) {
    return validateProjectFile(JSON.parse(await readFile(paths.projectJson, "utf8")), paths.projectJson);
  }
  if (!existsSync(paths.projectMd)) throw new Error(`Project does not exist: ${slug}`);

  const { data } = await readFrontmatter<ProjectFrontmatter>(paths.projectMd);
  const now = new Date().toISOString();
  const migrated: ProjectFileV1 = {
    schemaVersion: 1,
    id: randomUUID(),
    slug,
    name: data.title || slug,
    style: data.style || "default",
    editProfile: "talking_head",
    createdAt: data.created || now,
    updatedAt: data.updated || now,
  };
  await atomicWriteFile(paths.projectJson, `${JSON.stringify(migrated, null, 2)}\n`, { overwrite: false });
  return migrated;
}

export async function saveProjectFile(vaultPath: string, project: ProjectFileV1): Promise<void> {
  const paths = getProjectPaths(vaultPath, project.slug);
  const next = { ...project, updatedAt: new Date().toISOString() };
  await atomicWriteFile(paths.projectJson, `${JSON.stringify(next, null, 2)}\n`);
}
