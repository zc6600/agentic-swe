import type { Skill, SkillInput } from "@/features/private-skills/repository";

export type ImportedSkill = SkillInput & { id?: string };

export type SkillVariable = {
  name: string;
  defaultValue: string;
};

export function slugifySkillName(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u9fff]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "skill";
}

export function serializeSkillFile(skill: Skill) {
  const slug = skill.slug || slugifySkillName(skill.title);
  const lines = [
    "---",
    `id: ${JSON.stringify(skill.id)}`,
    `name: ${JSON.stringify(skill.title)}`,
    `slug: ${JSON.stringify(slug)}`,
    `description: ${JSON.stringify(skill.description)}`,
  ];
  if (skill.visibility) {
    lines.push(`visibility: ${JSON.stringify(skill.visibility)}`);
  }
  lines.push("---", "");

  return `${lines.join("\n")}${skill.content.trim()}\n`;
}

function parseScalar(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      throw new Error("Invalid quoted value in SKILL.md frontmatter.");
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

export function parseSkillFile(file: string): ImportedSkill {
  const match = file.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error("Missing YAML frontmatter. Start the file with name and description fields between --- lines.");

  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (field) metadata[field[1]] = parseScalar(field[2]);
  }

  const title = (metadata.name || metadata.title || "").trim();
  const description = (metadata.description || "").trim();
  const content = file.slice(match[0].length).trim();
  const id = metadata.id?.trim();
  const rawSlug = metadata.slug?.trim();
  const slug = rawSlug ? slugifySkillName(rawSlug) : slugifySkillName(title);
  const visibility = metadata.visibility === "public" ? "public" : "private";

  if (!title) throw new Error("Frontmatter must include a non-empty name field.");
  if (title.length > 100) throw new Error("The name must be 100 characters or fewer.");
  if (description.length > 500) throw new Error("The description must be 500 characters or fewer.");
  if (!content) throw new Error("The Markdown instructions are empty.");
  if (content.length > 100000) throw new Error("The Markdown instructions exceed 100,000 characters.");
  if (id && (id.includes("/") || id.length > 1500)) throw new Error("The id field is invalid.");

  return { id, title, slug, description, content, visibility };
}

export function skillFilename(title: string) {
  return `${slugifySkillName(title)}.md`;
}

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)(?::([^}]*))?\s*\}\}/g;

export function extractSkillVariables(
  content: string,
  extraFiles?: Record<string, string>,
): SkillVariable[] {
  const seen = new Map<string, string>();
  const sources = [content, ...Object.values(extraFiles ?? {})];

  for (const source of sources) {
    for (const match of source.matchAll(VARIABLE_PATTERN)) {
      const name = match[1].trim();
      const fallback = (match[2] ?? "").trim();
      if (!seen.has(name) || (!seen.get(name) && fallback)) {
        seen.set(name, fallback);
      }
    }
  }

  return Array.from(seen.entries()).map(([name, defaultValue]) => ({
    name,
    defaultValue,
  }));
}

export function interpolateSkillContent(
  text: string,
  values: Record<string, string>,
): string {
  return text.replace(VARIABLE_PATTERN, (_full, rawName: string, rawDefault?: string) => {
    const name = rawName.trim();
    const provided = values[name]?.trim();
    if (provided) return provided;
    const fallback = (rawDefault ?? "").trim();
    return fallback || `{{${name}}}`;
  });
}

export function estimateSkillTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.round(trimmed.length / 4));
}

export function countSkillLines(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\r?\n/).length;
}
