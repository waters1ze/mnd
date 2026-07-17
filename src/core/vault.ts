// src/core/vault.ts
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import matter from "gray-matter";
import { simpleGit } from "simple-git";
import type {
  RuleFrontmatter,
  StyleFrontmatter,
  SkillFrontmatter,
  ProjectFrontmatter,
  VaultRule,
  VaultStyle,
  VaultSkill,
} from "../types/vault.js";

// ─── Slugify ──────────────────────────────────────────────────────────────────

const CYRILLIC_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .split("")
    .map((ch) => CYRILLIC_MAP[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ─── Vault structure ──────────────────────────────────────────────────────────

const GITIGNORE_CONTENT = `# mnd vault gitignore
# Only Global_Rules/, Styles/, Skills/ are versioned
Assets/
Projects/
`;

export async function ensureVaultStructure(vaultPath: string): Promise<void> {
  const dirs = [
    "Global_Rules",
    "Styles",
    "Skills",
    "Assets",
    "Projects",
  ];

  for (const d of dirs) {
    await mkdir(join(vaultPath, d), { recursive: true });
  }

  // Write .gitignore that excludes Assets/ and Projects/
  const gitignorePath = join(vaultPath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, GITIGNORE_CONTENT, "utf-8");
  }

  const vaultMetaPath = join(vaultPath, ".mnd-vault.json");
  if (!existsSync(vaultMetaPath)) {
    await writeFile(vaultMetaPath, JSON.stringify({ version: 1 }, null, 2), "utf-8");
  }

  // Initialize git if not already
  const gitPath = join(vaultPath, ".git");
  if (!existsSync(gitPath)) {
    const git = simpleGit(vaultPath);
    await git.init();
    await git.add(".gitignore");
    await git.commit("chore: init mnd vault", { "--allow-empty": null });
  }
}

// ─── Frontmatter read/write ───────────────────────────────────────────────────

export async function readFrontmatter<T>(filePath: string): Promise<{ data: T; content: string }> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = matter(raw);
  return { data: parsed.data as T, content: parsed.content };
}

export async function writeFrontmatter<T extends object>(
  filePath: string,
  data: T,
  content: string
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const output = matter.stringify(content, data);
  await writeFile(filePath, output, "utf-8");
}

// ─── List helpers ─────────────────────────────────────────────────────────────

export async function listRules(vaultPath: string): Promise<VaultRule[]> {
  const dir = join(vaultPath, "Global_Rules");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const rules: VaultRule[] = [];
  for (const f of files) {
    const filePath = join(dir, f);
    const { data, content } = await readFrontmatter<RuleFrontmatter>(filePath);
    rules.push({ id: data.id, filePath, frontmatter: data, body: content });
  }
  return rules;
}

export async function listStyles(vaultPath: string): Promise<VaultStyle[]> {
  const dir = join(vaultPath, "Styles");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const styles: VaultStyle[] = [];
  for (const f of files) {
    const filePath = join(dir, f);
    const { data, content } = await readFrontmatter<StyleFrontmatter>(filePath);
    styles.push({
      name: basename(f, ".md"),
      filePath,
      frontmatter: data,
      body: content,
    });
  }
  return styles;
}

export async function listSkills(vaultPath: string): Promise<VaultSkill[]> {
  const dir = join(vaultPath, "Skills");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const skills: VaultSkill[] = [];
  for (const f of files) {
    const filePath = join(dir, f);
    const { data, content } = await readFrontmatter<SkillFrontmatter>(filePath);
    skills.push({
      name: basename(f, ".md"),
      filePath,
      frontmatter: data,
      body: content,
    });
  }
  return skills;
}

export async function listProjects(vaultPath: string): Promise<Array<{
  slug: string;
  filePath: string;
  frontmatter: ProjectFrontmatter;
}>> {
  const dir = join(vaultPath, "Projects");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const mdPath = join(dir, entry.name, "project.md");
    if (!existsSync(mdPath)) continue;
    const { data } = await readFrontmatter<ProjectFrontmatter>(mdPath);
    projects.push({ slug: entry.name, filePath: mdPath, frontmatter: data });
  }
  return projects;
}

// ─── Project creation ─────────────────────────────────────────────────────────

export async function createProject(
  vaultPath: string,
  name: string,
  style: string
): Promise<string> {
  const slug = slugify(name);
  const projectDir = join(vaultPath, "Projects", slug);

  await mkdir(join(projectDir, "raw"), { recursive: true });
  await mkdir(join(projectDir, "reports"), { recursive: true });
  await mkdir(join(projectDir, ".mnd"), { recursive: true });

  const now = new Date().toISOString();
  const frontmatter: ProjectFrontmatter = {
    slug,
    style,
    status: "created",
    created: now,
    updated: now,
    title: name,
  };

  await writeFrontmatter(
    join(projectDir, "project.md"),
    frontmatter,
    `# ${name}\n\nProject created by mnd.\n`
  );

  return slug;
}

export async function updateProjectFrontmatter(
  vaultPath: string,
  slug: string,
  updater: (fm: ProjectFrontmatter) => void
): Promise<void> {
  const mdPath = join(vaultPath, "Projects", slug, "project.md");
  const { data, content } = await readFrontmatter<ProjectFrontmatter>(mdPath);
  updater(data);
  data.updated = new Date().toISOString();
  await writeFrontmatter(mdPath, data, content);
}

// ─── Git operations (scoped to versioned folders only) ────────────────────────

export async function gitCommitInVault(
  vaultPath: string,
  message: string,
  files: string[]
): Promise<void> {
  const git = simpleGit(vaultPath);
  // Only add files that are within Global_Rules/, Styles/, Skills/
  const VERSIONED = ["Global_Rules", "Styles", "Skills"];
  const safe = files.filter((f) =>
    VERSIONED.some((d) => f.startsWith(join(vaultPath, d)))
  );
  if (safe.length === 0) return;
  await git.add(safe);
  await git.commit(message);
}

// ─── Asset sidecar notes ──────────────────────────────────────────────────────

export async function writeAssetSidecar(
  vaultPath: string,
  assetFileName: string,
  tags: string[],
  description: string
): Promise<void> {
  const sidecarPath = join(vaultPath, "Assets", `${assetFileName}.md`);
  await writeFrontmatter(sidecarPath, { tags, description }, `# ${assetFileName}\n`);
}

// ─── Helper: check file mod time ──────────────────────────────────────────────

export async function getFileMtime(filePath: string): Promise<Date | null> {
  try {
    const s = await stat(filePath);
    return s.mtime;
  } catch {
    return null;
  }
}
