// src/types/vault.ts

export interface RuleFrontmatter {
  id: string;
  category: string;
  created: string;
  updated: string;
}

export interface StyleFrontmatter {
  id: string;
  based_on?: string;
  skills: string[];
  updated: string;
}

export interface SkillFrontmatter {
  id: string;
  type: "prompt" | "code" | "hybrid";
  code_ref?: string;
  used_in_styles: string[];
}

export interface ProjectFrontmatter {
  slug: string;
  style: string;
  status: "created" | "analyzed" | "approved" | "exported";
  created: string;
  updated: string;
  title?: string;
}

export interface AssetSidecarFrontmatter {
  tags: string[];
  description: string;
}

export interface VaultRule {
  id: string;
  filePath: string;
  frontmatter: RuleFrontmatter;
  body: string;
}

export interface VaultStyle {
  name: string;
  filePath: string;
  frontmatter: StyleFrontmatter;
  body: string;
}

export interface VaultSkill {
  name: string;
  filePath: string;
  frontmatter: SkillFrontmatter;
  body: string;
}
