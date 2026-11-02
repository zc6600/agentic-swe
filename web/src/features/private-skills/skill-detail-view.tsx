"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Skill } from "@/features/private-skills/repository";
import {
  countSkillLines,
  estimateSkillTokens,
  extractSkillVariables,
  interpolateSkillContent,
  serializeSkillFile,
  skillFilename,
  slugifySkillName,
} from "@/features/private-skills/skill-file";

type TargetDirOption = {
  id: string;
  label: string;
  baseDir: string;
};

const TARGET_DIRS: TargetDirOption[] = [
  { id: "claude", label: ".claude/skills", baseDir: ".claude/skills" },
  { id: "agents", label: ".agents/skills", baseDir: ".agents/skills" },
  { id: "repo", label: "skills/", baseDir: "skills" },
  { id: "cursor", label: ".cursor/skills", baseDir: ".cursor/skills" },
];

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={idx}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a key={idx} href={linkMatch[2]} target="_blank" rel="noreferrer">
          {linkMatch[1]}
        </a>
      );
    }
    return part;
  });
}

function RenderedMarkdown({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => {
    const lines = markdown.split(/\r?\n/);
    const elements: ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith("```")) {
        const lang = line.slice(3).trim();
        const codeLines: string[] = [];
        i += 1;
        while (i < lines.length && !lines[i].startsWith("```")) {
          codeLines.push(lines[i]);
          i += 1;
        }
        i += 1;
        elements.push(
          <pre tabIndex={0} key={`code-${i}`}>
            <code className={lang ? `language-${lang}` : undefined}>{codeLines.join("\n")}</code>
          </pre>,
        );
        continue;
      }

      if (!line.trim()) {
        i += 1;
        continue;
      }

      const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2].trim();
        if (level === 1) {
          elements.push(<h3 className="skill-md-h1" key={`h-${i}`}>{renderInlineMarkdown(text)}</h3>);
        } else if (level === 2) {
          elements.push(<h4 className="skill-md-h2" key={`h-${i}`}>{renderInlineMarkdown(text)}</h4>);
        } else {
          elements.push(<h5 className="skill-md-h3" key={`h-${i}`}>{renderInlineMarkdown(text)}</h5>);
        }
        i += 1;
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\d+\.\s+/, "").trim());
          i += 1;
        }
        elements.push(
          <ol className="skill-md-list" key={`ol-${i}`}>
            {items.map((item, idx) => (
              <li key={idx}>{renderInlineMarkdown(item)}</li>
            ))}
          </ol>,
        );
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^[-*]\s+/, "").trim());
          i += 1;
        }
        elements.push(
          <ul className="skill-md-list" key={`ul-${i}`}>
            {items.map((item, idx) => (
              <li key={idx}>{renderInlineMarkdown(item)}</li>
            ))}
          </ul>,
        );
        continue;
      }

      const paragraphLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].startsWith("```") &&
        !/^(#{1,3}|\d+\.|[-*])\s+/.test(lines[i])
      ) {
        paragraphLines.push(lines[i].trim());
        i += 1;
      }
      elements.push(
        <p className="skill-md-p" key={`p-${i}`}>
          {renderInlineMarkdown(paragraphLines.join(" "))}
        </p>,
      );
    }

    return elements;
  }, [markdown]);

  return <div className="hf-rendered-body">{blocks}</div>;
}

type SkillDetailViewProps = {
  skill: Skill;
  isOwner?: boolean;
  canClone?: boolean;
  onBack?: () => void;
  onEdit?: (skill: Skill) => void;
  onDelete?: (skill: Skill) => void;
  onClone?: (skill: Skill, interpolatedContent: string) => void;
};

export function SkillDetailView({
  skill,
  isOwner = false,
  canClone = false,
  onBack,
  onEdit,
  onDelete,
  onClone,
}: SkillDetailViewProps) {
  const slug = skill.slug || slugifySkillName(skill.title);
  const ownerHandle = skill.ownerHandle || (skill.official ? "agentic-swe" : "vault");
  const fullHandle = `@${ownerHandle}/${slug}`;

  const variables = useMemo(
    () => extractSkillVariables(skill.content, skill.files),
    [skill.content, skill.files],
  );

  const [varOverrides, setVarOverrides] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>("rendered");
  const [targetDirId, setTargetDirId] = useState<string>("claude");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const effectiveVars = useMemo(() => {
    const merged: Record<string, string> = {};
    for (const v of variables) {
      merged[v.name] = varOverrides[v.name] !== undefined ? varOverrides[v.name] : v.defaultValue;
    }
    return merged;
  }, [variables, varOverrides]);

  const interpolatedContent = useMemo(
    () => interpolateSkillContent(skill.content, effectiveVars),
    [skill.content, effectiveVars],
  );

  const rawSkillFile = useMemo(
    () => serializeSkillFile({ ...skill, slug, content: interpolatedContent }),
    [skill, slug, interpolatedContent],
  );

  const extraFileNames = useMemo(() => Object.keys(skill.files ?? {}), [skill.files]);
  const tokenEstimate = useMemo(() => estimateSkillTokens(rawSkillFile), [rawSkillFile]);
  const lineCount = useMemo(() => countSkillLines(rawSkillFile), [rawSkillFile]);

  const selectedTarget = TARGET_DIRS.find((item) => item.id === targetDirId) ?? TARGET_DIRS[0];
  const installDir = `${selectedTarget.baseDir}/${slug}`;
  const installPath = `${installDir}/SKILL.md`;

  const agentPrompt = useMemo(() => {
    return `Apply ${fullHandle}:\n\n\`\`\`markdown\n${rawSkillFile.trim()}\n\`\`\``;
  }, [fullHandle, rawSkillFile]);

  const cliCommand = useMemo(() => {
    const safeEof = "SKILL_EOF";
    return `mkdir -p "${installDir}" && cat << '${safeEof}' > "${installPath}"\n${rawSkillFile.trim()}\n${safeEof}`;
  }, [installDir, installPath, rawSkillFile]);

  function copyText(key: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1800);
    });
  }

  function downloadMarkdown() {
    const file = new Blob([rawSkillFile], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = skillFilename(skill.title);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <article className="hf-detail-page" aria-label={`Skill ${skill.title}`}>
      {onBack && (
        <div className="hf-detail-Breadcrumb">
          <button type="button" className="hf-back-btn" onClick={onBack}>
            ← All Skills
          </button>
        </div>
      )}

      <div className="hf-skill-card">
        <header className="hf-skill-header">
          <div className="hf-skill-header-main">
            <h1 className="hf-detail-main-title">{skill.title}</h1>
            {skill.description && <p className="hf-skill-summary">{skill.description}</p>}
            <div className="hf-meta-row">
              <span className="hf-owner-tag">{fullHandle}</span>
              <span className={`hf-badge ${skill.official ? "hf-badge-official" : skill.visibility === "public" ? "hf-badge-public" : "hf-badge-private"}`}>
                {skill.official ? "Official" : skill.visibility === "public" ? "Public" : "Private"}
              </span>
              <span className="hf-token-pill">~{tokenEstimate} tokens · {lineCount} lines</span>
            </div>
          </div>

          <div className="hf-header-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => copyText("use-prompt", agentPrompt)}
            >
              {copiedKey === "use-prompt" ? "Copied Prompt ✓" : "Copy for Agent"}
            </button>
            <button type="button" className="secondary-button" onClick={downloadMarkdown}>
              Download .md
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => copyText("share-link", `${window.location.origin}/#${ownerHandle}/${slug}`)}
            >
              {copiedKey === "share-link" ? "Link copied ✓" : "Copy link"}
            </button>
            {canClone && onClone && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onClone(skill, interpolatedContent)}
              >
                Save to Vault
              </button>
            )}
            {isOwner && onEdit && (
              <button type="button" className="secondary-button" onClick={() => onEdit(skill)}>
                Edit
              </button>
            )}
            {isOwner && onDelete && (
              <button type="button" className="secondary-button danger-button" onClick={() => onDelete(skill)}>
                Delete
              </button>
            )}
          </div>
        </header>

        {variables.length > 0 && (
          <div className="hf-inline-vars" aria-label="Configure skill variables">
            <span className="hf-inline-vars-label">Configure:</span>
            {variables.map((variable) => {
              const inputId = `var-${skill.id}-${variable.name}`;
              return (
                <div className="hf-inline-var-item" key={variable.name}>
                  <label htmlFor={inputId}>{variable.name}</label>
                  <input
                    id={inputId}
                    type="text"
                    value={effectiveVars[variable.name] ?? ""}
                    placeholder={variable.defaultValue}
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    onChange={(event) =>
                      setVarOverrides((prev) => ({
                        ...prev,
                        [variable.name]: event.target.value,
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="hf-file-tabs" role="tablist" aria-label="Skill views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "rendered"}
            className={`hf-tab-btn${activeTab === "rendered" ? " active" : ""}`}
            onClick={() => setActiveTab("rendered")}
          >
            Overview & Steps
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "raw"}
            className={`hf-tab-btn${activeTab === "raw" ? " active" : ""}`}
            onClick={() => setActiveTab("raw")}
          >
            SKILL.md
          </button>
          {extraFileNames.map((filename) => (
            <button
              key={filename}
              type="button"
              role="tab"
              aria-selected={activeTab === filename}
              className={`hf-tab-btn${activeTab === filename ? " active" : ""}`}
              onClick={() => setActiveTab(filename)}
            >
              {filename}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "cli"}
            className={`hf-tab-btn${activeTab === "cli" ? " active" : ""}`}
            onClick={() => setActiveTab("cli")}
          >
            CLI Install
          </button>
        </div>

        <div className="hf-spec-panel">
          {activeTab === "rendered" ? (
            <RenderedMarkdown markdown={interpolatedContent} />
          ) : activeTab === "raw" ? (
            <div className="hf-raw-container">
              <div className="hf-raw-toolbar">
                <span>SKILL.md</span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => copyText("raw-spec", rawSkillFile)}
                >
                  {copiedKey === "raw-spec" ? "Copied ✓" : "Copy SKILL.md"}
                </button>
              </div>
              <pre tabIndex={0} className="hf-raw-pre">
                <code>{rawSkillFile}</code>
              </pre>
            </div>
          ) : activeTab === "cli" ? (
            <div className="hf-raw-container">
              <div className="hf-raw-toolbar">
                <div className="hf-target-pills" role="radiogroup" aria-label="Target directory">
                  {TARGET_DIRS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={targetDirId === option.id}
                      className={`hf-pill-btn${targetDirId === option.id ? " active" : ""}`}
                      onClick={() => setTargetDirId(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => copyText("use-cli", cliCommand)}
                >
                  {copiedKey === "use-cli" ? "Copied ✓" : "Copy Command"}
                </button>
              </div>
              <pre tabIndex={0} className="hf-raw-pre">
                <code>{cliCommand}</code>
              </pre>
            </div>
          ) : (
            <div className="hf-raw-container">
              <div className="hf-raw-toolbar">
                <code>{activeTab}</code>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    copyText(
                      `file-${activeTab}`,
                      interpolateSkillContent(skill.files?.[activeTab] ?? "", effectiveVars),
                    )
                  }
                >
                  {copiedKey === `file-${activeTab}` ? "Copied ✓" : "Copy File"}
                </button>
              </div>
              <pre tabIndex={0} className="hf-raw-pre">
                <code>
                  {interpolateSkillContent(skill.files?.[activeTab] ?? "", effectiveVars)}
                </code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
