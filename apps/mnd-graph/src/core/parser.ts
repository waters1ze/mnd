import { parse } from 'yaml';
import { GraphNode } from './types';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const WIKILINK_REGEX = /\[\[(.*?)\]\]/g;

export function parseMarkdownNote(path: string, content: string): Partial<GraphNode> & { properties: Record<string, any>; links: string[] } {
  let properties: Record<string, any> = {};
  let body = content;

  const fmMatch = content.match(FRONTMATTER_REGEX);
  if (fmMatch) {
    try {
      properties = parse(fmMatch[1]) || {};
      body = content.slice(fmMatch[0].length);
    } catch (e) {
      console.warn(`Failed to parse frontmatter in ${path}`, e);
    }
  }

  const links = extractWikilinks(body);
  
  // Also extract wikilinks from frontmatter properties (e.g. lists of strings that might be wikilinks)
  extractLinksFromObject(properties, links);

  const tags = Array.isArray(properties.tags) ? properties.tags : [];

  return {
    path,
    properties,
    content: body, // Keep body for full text search
    links: Array.from(new Set(links)), // Unique links
    title: properties.title || inferTitleFromPath(path),
    tags,
    type: properties.mnd_type || 'unknown',
    created: properties.created,
    updated: properties.updated,
  };
}

function extractWikilinks(text: string): string[] {
  const links: string[] = [];
  let match;
  while ((match = WIKILINK_REGEX.exec(text)) !== null) {
    const linkText = match[1].split('|')[0].trim(); // Handle aliases: [[Link|Alias]]
    if (linkText) links.push(linkText);
  }
  return links;
}

function extractLinksFromObject(obj: any, links: string[]) {
  if (typeof obj === 'string') {
    const extracted = extractWikilinks(obj);
    links.push(...extracted);
  } else if (Array.isArray(obj)) {
    obj.forEach(item => extractLinksFromObject(item, links));
  } else if (obj !== null && typeof obj === 'object') {
    Object.values(obj).forEach(val => extractLinksFromObject(val, links));
  }
}

export function inferTitleFromPath(path: string): string {
  // Extract basename without extension
  const parts = path.split(/[/\\]/);
  const basename = parts[parts.length - 1];
  const name = basename.substring(0, basename.lastIndexOf('.')) || basename;
  return name;
}
