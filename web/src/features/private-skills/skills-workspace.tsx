"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ChangeEvent } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { OFFICIAL_SKILLS } from "@/features/private-skills/official-skills";
import {
  createSkill,
  deleteSkill,
  deriveUserHandle,
  subscribeToPublicSkills,
  subscribeToSkills,
  updateSkill,
  type Skill,
  type SkillInput,
  type SkillVisibility,
} from "@/features/private-skills/repository";
import { SkillDetailView } from "@/features/private-skills/skill-detail-view";
import {
  estimateSkillTokens,
  extractSkillVariables,
  parseSkillFile,
  slugifySkillName,
} from "@/features/private-skills/skill-file";

const emptySkill: SkillInput = {
  title: "",
  slug: "",
  description: "",
  content: "",
  visibility: "private",
};

type FilterScope = "all" | "vault";

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const readHash = () => decodeURIComponent(window.location.hash.slice(1));
const readServerHash = () => "";

function skillRef(skill: Skill) {
  const owner = skill.ownerHandle || (skill.official ? "agentic-swe" : "vault");
  return `${owner}/${skill.slug || slugifySkillName(skill.title)}`;
}

function setRef(ref: string | null) {
  window.location.hash = ref ?? "";
}

export function SkillsWorkspace() {
  const { user, loading: authLoading, configured } = useAuth();
  const userHandle = useMemo(
    () => (user ? deriveUserHandle(user.displayName, user.email) : "vault"),
    [user],
  );

  const [vaultSkills, setVaultSkills] = useState<Skill[]>([]);
  const [publicSkills, setPublicSkills] = useState<Skill[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);

  const selectedRef = useSyncExternalStore(subscribeToHash, readHash, readServerHash);
  const [filterScope, setFilterScope] = useState<FilterScope>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<SkillInput>(emptySkill);
  const [customSlug, setCustomSlug] = useState(false);

  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!configured || !user) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVaultLoading(true);
    const unsubscribe = subscribeToSkills(
      user.uid,
      (records) => {
        if (!active) return;
        setVaultSkills(
          records.map((item) => ({
            ...item,
            ownerHandle: item.ownerHandle || userHandle,
          })),
        );
        setVaultLoading(false);
      },
      (cause) => {
        if (!active) return;
        setError(cause.message);
        setVaultLoading(false);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [configured, user, userHandle]);

  useEffect(() => {
    if (!configured) return;
    return subscribeToPublicSkills((records) => {
      setPublicSkills(records);
    });
  }, [configured]);

  const effectiveVaultSkills = useMemo(
    () => (user ? vaultSkills : []),
    [user, vaultSkills],
  );

  const allSkills = useMemo(() => {
    const map = new Map<string, Skill>();
    for (const skill of OFFICIAL_SKILLS) {
      map.set(skill.id, skill);
    }
    for (const skill of effectiveVaultSkills) {
      map.set(skill.id, skill);
    }
    for (const skill of publicSkills) {
      if (!map.has(skill.id)) {
        map.set(skill.id, skill);
      }
    }
    return Array.from(map.values());
  }, [effectiveVaultSkills, publicSkills]);

  const filteredSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allSkills.filter((skill) => {
      if (filterScope === "vault" && (!user || skill.ownerUid !== user.uid)) return false;

      if (!q) return true;
      const slug = skill.slug || slugifySkillName(skill.title);
      const handle = `@${skill.ownerHandle || "vault"}/${slug}`.toLowerCase();
      return (
        skill.title.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        handle.includes(q)
      );
    });
  }, [allSkills, filterScope, searchQuery, user]);

  const activeSkill = useMemo(
    () => (selectedRef ? allSkills.find((s) => skillRef(s) === selectedRef) ?? null : null),
    [allSkills, selectedRef],
  );

  function openNewSkillEditor() {
    setValues(emptySkill);
    setEditingId(null);
    setCustomSlug(false);
    setEditorOpen(true);
    setStatus("");
    setError("");
  }

  function openEditSkillEditor(skill: Skill) {
    setValues({
      title: skill.title,
      slug: skill.slug || slugifySkillName(skill.title),
      description: skill.description,
      content: skill.content,
      visibility: skill.visibility || "private",
    });
    setEditingId(skill.id);
    setCustomSlug(true);
    setEditorOpen(true);
    setStatus("");
    setError("");
  }

  function closeEditor() {
    setValues(emptySkill);
    setEditingId(null);
    setCustomSlug(false);
    setEditorOpen(false);
  }

  function insertVariablePlaceholder() {
    const snippet = "{{VAR_NAME:default}}";
    setValues((prev) => ({
      ...prev,
      content: prev.content ? `${prev.content}\n${snippet}` : snippet,
    }));
  }

  async function saveSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      setError("Sign in to save skills.");
      return;
    }
    const cleanTitle = values.title.trim();
    const cleanContent = values.content.trim();
    if (!cleanTitle || !cleanContent) return;

    const cleanValues: SkillInput = {
      title: cleanTitle,
      slug: slugifySkillName(values.slug?.trim() || cleanTitle),
      description: values.description.trim(),
      content: cleanContent,
      visibility: values.visibility === "public" ? "public" : "private",
      ownerHandle: userHandle,
    };

    setBusy(true);
    setStatus("Saving…");
    setError("");
    try {
      if (editingId) {
        await updateSkill(user.uid, editingId, cleanValues, userHandle);
      } else {
        await createSkill(user.uid, cleanValues, userHandle);
      }
      setRef(`${userHandle}/${cleanValues.slug}`);
      closeEditor();
      setStatus("Saved.");
    } catch (cause) {
      setError(`Could not save: ${(cause as Error).message}`);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function handleCloneToVault(sourceSkill: Skill, interpolatedContent: string) {
    if (!user) {
      setError("Sign in to save skills to your vault.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const cloneSlug = slugifySkillName(sourceSkill.slug || sourceSkill.title);
      await createSkill(
        user.uid,
        {
          title: sourceSkill.title,
          slug: cloneSlug,
          description: sourceSkill.description,
          content: interpolatedContent,
          visibility: "private",
          ownerHandle: userHandle,
        },
        userHandle,
      );
      setRef(`${userHandle}/${cloneSlug}`);
      setStatus(`Saved to @${userHandle}/${cloneSlug}`);
    } catch (cause) {
      setError(`Could not save copy: ${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSkill(skill: Skill) {
    if (!user) return;
    if (!window.confirm(`Delete “${skill.title}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteSkill(user.uid, skill.id);
      setStatus("Deleted.");
      setRef(null);
    } catch (cause) {
      setError(`Could not delete: ${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || !user) return;

    setFileBusy(true);
    setError("");
    setStatus("");
    const knownIds = new Set(effectiveVaultSkills.map((skill) => skill.id));
    let added = 0;
    let updated = 0;
    let lastRef: string | null = null;
    const failures: string[] = [];

    for (const file of files) {
      try {
        const imported = parseSkillFile(await file.text());
        const existingId = imported.id && knownIds.has(imported.id) ? imported.id : undefined;
        const payload: SkillInput = {
          title: imported.title,
          slug: imported.slug || slugifySkillName(imported.title),
          description: imported.description,
          content: imported.content,
          visibility: imported.visibility || "private",
          ownerHandle: userHandle,
        };
        if (existingId) {
          await updateSkill(user.uid, existingId, payload, userHandle);
          lastRef = `${userHandle}/${payload.slug}`;
          updated += 1;
        } else {
          const id = await createSkill(user.uid, payload, userHandle);
          knownIds.add(id);
          lastRef = `${userHandle}/${payload.slug}`;
          added += 1;
        }
      } catch (cause) {
        failures.push(`${file.name}: ${(cause as Error).message}`);
      }
    }

    if (lastRef) setRef(lastRef);
    if (failures.length) {
      setError(failures.join(" "));
    } else {
      setStatus(`Imported: ${added} added, ${updated} updated.`);
    }
    setFileBusy(false);
  }

  if (editorOpen) {
    return (
      <section className="skills-app">
        <div className="hf-detail-Breadcrumb">
          <button type="button" className="hf-back-btn" onClick={closeEditor}>
            ← Back
          </button>
        </div>
        <section className="hf-studio-panel" aria-label={editingId ? "Edit skill" : "New skill"}>
          <div className="hf-studio-header">
            <h2>{editingId ? "Edit Skill" : "New Skill"}</h2>
          </div>

          <form className="hf-studio-form" onSubmit={(event) => void saveSkill(event)}>
            <div className="hf-form-row-2">
              <div>
                <label htmlFor="skill-title">Skill Title</label>
                <input
                  id="skill-title"
                  name="title"
                  value={values.title}
                  maxLength={100}
                  required
                  placeholder="e.g. PR Conflict Repair"
                  onChange={(event) => {
                    const nextTitle = event.target.value;
                    setValues((prev) => ({
                      ...prev,
                      title: nextTitle,
                      slug: customSlug ? prev.slug : slugifySkillName(nextTitle),
                    }));
                  }}
                />
              </div>
              <div>
                <label htmlFor="skill-slug">Slug (@{userHandle}/…)</label>
                <input
                  id="skill-slug"
                  name="slug"
                  value={values.slug ?? ""}
                  maxLength={80}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="pr-conflict-repair"
                  onChange={(event) => {
                    setCustomSlug(true);
                    setValues((prev) => ({ ...prev, slug: event.target.value }));
                  }}
                />
              </div>
            </div>

            <div className="hf-form-row-2">
              <div>
                <label htmlFor="skill-description">Short summary</label>
                <input
                  id="skill-description"
                  name="description"
                  value={values.description}
                  maxLength={500}
                  placeholder="What this skill does and when the agent uses it"
                  onChange={(event) => setValues((prev) => ({ ...prev, description: event.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="skill-visibility">Visibility</label>
                <div className="hf-radio-inline" id="skill-visibility">
                  <label className="hf-radio-option">
                    <input
                      type="radio"
                      name="visibility"
                      value="private"
                      checked={(values.visibility ?? "private") === "private"}
                      onChange={() => setValues((prev) => ({ ...prev, visibility: "private" as SkillVisibility }))}
                    />
                    <span>Private</span>
                  </label>
                  <label className="hf-radio-option">
                    <input
                      type="radio"
                      name="visibility"
                      value="public"
                      checked={values.visibility === "public"}
                      onChange={() => setValues((prev) => ({ ...prev, visibility: "public" as SkillVisibility }))}
                    />
                    <span>Public</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="hf-label-bar">
              <label htmlFor="skill-content">Markdown instructions</label>
              <button
                type="button"
                className="hf-insert-var-btn"
                onClick={insertVariablePlaceholder}
              >
                + Insert <code>{"{{VAR:default}}"}</code>
              </button>
            </div>
            <textarea
              id="skill-content"
              name="content"
              value={values.content}
              rows={15}
              maxLength={100000}
              required
              placeholder="Write skill instructions in Markdown. Use {{CMD:npm test}} for configurable parameters."
              onChange={(event) => setValues((prev) => ({ ...prev, content: event.target.value }))}
            />

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save Skill"}
              </button>
              <button className="secondary-button" type="button" onClick={closeEditor}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      </section>
    );
  }

  if (activeSkill) {
    return (
      <section className="skills-app">
        {(error || status) && (
          <p className={`status${error ? " error" : ""}`} role="status" aria-live="polite">
            {error || status}
          </p>
        )}
        <SkillDetailView
          key={activeSkill.id}
          skill={activeSkill}
          onBack={() => setRef(null)}
          isOwner={Boolean(user && activeSkill.ownerUid === user.uid && !activeSkill.official)}
          canClone={Boolean(user && (activeSkill.official || activeSkill.ownerUid !== user.uid))}
          onEdit={openEditSkillEditor}
          onDelete={(skill) => void handleDeleteSkill(skill)}
          onClone={(skill, interpolated) => void handleCloneToVault(skill, interpolated)}
        />
      </section>
    );
  }

  return (
    <section className="skills-app">
      <div className="hf-home-hero">
        <div>
          <h1>Skills Hub</h1>
          <p className="hf-home-sub">
            Select a skill to inspect instructions, configure parameters, and copy for your coding agent.
          </p>
        </div>

        <div className="hf-hub-actions">
          {user ? (
            <>
              <button type="button" className="primary-button" onClick={openNewSkillEditor}>
                + New Skill
              </button>
              <input
                ref={importInput}
                className="visually-hidden"
                type="file"
                accept=".md,.markdown,text/markdown"
                multiple
                aria-label="Import Markdown skill files"
                onChange={(event) => void importFiles(event)}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={fileBusy || vaultLoading}
                onClick={() => importInput.current?.click()}
              >
                {fileBusy ? "…" : "Import .md"}
              </button>
            </>
          ) : (
            <a className="secondary-button" href="/login/">
              Sign in to upload
            </a>
          )}
        </div>
      </div>

      <div className="hf-toolbar-row">
        <search className="hf-home-search">
          <label htmlFor="skill-search-input" className="visually-hidden">
            Search skills
          </label>
          <input
            id="skill-search-input"
            type="search"
            value={searchQuery}
            placeholder="Search skills by name or keyword…"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </search>

        {user && (
          <div className="hf-target-pills" role="tablist" aria-label="Filter scope">
            <button
              type="button"
              role="tab"
              aria-selected={filterScope === "all"}
              className={`hf-pill-btn${filterScope === "all" ? " active" : ""}`}
              onClick={() => setFilterScope("all")}
            >
              All Skills ({allSkills.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filterScope === "vault"}
              className={`hf-pill-btn${filterScope === "vault" ? " active" : ""}`}
              onClick={() => setFilterScope("vault")}
            >
              My Vault ({effectiveVaultSkills.length})
            </button>
          </div>
        )}
      </div>

      {(error || status) && (
        <p className={`status${error ? " error" : ""}`} role="status" aria-live="polite">
          {error || status}
        </p>
      )}

      {filterScope === "vault" && !user && !authLoading ? (
        <div className="auth-panel">
          <h2>Sign in to view your vault</h2>
          <a className="primary-button login-link" href="/login/">
            Sign in with Google
          </a>
        </div>
      ) : filteredSkills.length === 0 ? (
        <p className="status">No matching skills found.</p>
      ) : (
        <ul className="hf-directory-grid" aria-label="Skills directory">
          {filteredSkills.map((skill) => {
            const slug = skill.slug || slugifySkillName(skill.title);
            const owner = skill.ownerHandle || (skill.official ? "agentic-swe" : "vault");
            const tokens = estimateSkillTokens(skill.content);
            const vars = extractSkillVariables(skill.content, skill.files).length;

            return (
              <li key={skill.id} className="hf-dir-item">
                <button
                  type="button"
                  className="hf-dir-card"
                  onClick={() => setRef(skillRef(skill))}
                >
                  <div className="hf-dir-card-body">
                    <div className="hf-dir-title-row">
                      <h2 className="hf-dir-title">{skill.title}</h2>
                      <span className="hf-dir-arrow" aria-hidden="true">→</span>
                    </div>
                    <p className="hf-dir-desc">
                      {skill.description || "Reusable workflow and coding agent instructions."}
                    </p>
                  </div>

                  <div className="hf-dir-footer">
                    <span className="hf-dir-owner">@{owner}/{slug}</span>
                    <div className="hf-dir-badges">
                      {vars > 0 && <span className="hf-dir-stat">{vars} {vars === 1 ? "param" : "params"}</span>}
                      <span className="hf-dir-stat">~{tokens} tokens</span>
                      <span className={`hf-badge ${skill.official ? "hf-badge-official" : skill.visibility === "public" ? "hf-badge-public" : "hf-badge-private"}`}>
                        {skill.official ? "Official" : skill.visibility === "public" ? "Public" : "Private"}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
