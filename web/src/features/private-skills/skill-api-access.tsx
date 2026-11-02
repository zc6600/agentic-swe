"use client";

import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { getFunctions } from "firebase/functions";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { getFirebaseClient } from "@/lib/firebase/client";

type TokenRecord = { id: string; createdAt: string | null; expiresAt: string; revoked: boolean; expired: boolean };
type IssuedToken = { id: string; token: string; expiresAt: string };
const API_URL = "https://asia-southeast1-agentic-swe-skills.cloudfunctions.net/uploadSkill";

function describeError(cause: unknown) {
  const error = cause as { code?: string; message?: string } | null;
  switch (error?.code) {
    case "functions/unauthenticated": return "Your session expired. Sign in again and retry.";
    case "functions/permission-denied": return "This account is not allowed to manage this token.";
    case "functions/not-found": return "This token no longer exists. Refresh the page and try again.";
    case "functions/unavailable": return "Firebase is temporarily unavailable. Try again shortly.";
    default: return error?.message || "An unexpected error occurred. Try again.";
  }
}

export function SkillApiAccess() {
  const { user, loading, configured } = useAuth();
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [hours, setHours] = useState(24);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const client = getFirebaseClient();
  const functions = client ? getFunctions(client.app, "asia-southeast1") : null;

  const loadTokens = useCallback(async () => {
    if (!functions || !user) return [];
    const call = httpsCallable<void, { tokens: TokenRecord[] }>(functions, "listSkillUploadTokens");
    const result = await call();
    const now = Date.now();
    return result.data.tokens.map((token) => ({ ...token, expired: Date.parse(token.expiresAt) <= now }));
  }, [functions, user]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const records = await loadTokens();
        if (active) setTokens(records);
      } catch (cause) {
        if (active) setError((cause as Error).message);
      }
    }
    void load();
    return () => { active = false; };
  }, [loadTokens]);

  async function createToken() {
    if (!functions) return;
    setBusy(true); setError(""); setMessage(""); setIssued(null);
    try {
      const call = httpsCallable<{ hours: number }, IssuedToken>(functions, "createSkillUploadToken");
      const result = await call({ hours });
      setIssued(result.data);
      setMessage("Token created. Copy the instructions now; the secret will not be shown again after you leave this page.");
      setTokens((current) => [{ id: result.data.id, createdAt: null, expiresAt: result.data.expiresAt, revoked: false, expired: false }, ...current]);
      try {
        setTokens(await loadTokens());
      } catch {
        setMessage("Token created, but the list could not refresh. Reload this page to update it.");
      }
    } catch (cause) { setError(`Could not create token: ${describeError(cause)}`); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (!functions) return;
    setBusy(true); setError("");
    try {
      const call = httpsCallable<{ id: string }, { ok: boolean }>(functions, "revokeSkillUploadToken");
      await call({ id });
      setTokens((current) => current.map((token) => token.id === id ? { ...token, revoked: true } : token));
      setMessage("Token revoked.");
      if (issued?.id === id) setIssued(null);
      try {
        setTokens(await loadTokens());
      } catch {
        setMessage("Token revoked, but the list could not refresh. Reload this page to update it.");
      }
    } catch (cause) { setError(`Could not revoke token: ${describeError(cause)}`); }
    finally { setBusy(false); }
  }

  const prompt = issued ? `Upload or update this skill in my Skills Vault.\n\nAPI: ${API_URL}\nBearer token: ${issued.token}\nToken expires: ${issued.expiresAt}\n\nSend a POST request with Content-Type: application/json and Authorization: Bearer <token>. Request body: {"title":"Skill name","slug":"skill-slug","visibility":"private","description":"When the agent should trigger this skill","content":"Full Markdown instructions (use {{VAR_NAME:default}} for configurable inputs)"}. If a skill with the same slug already exists in my vault, it will be updated in place. Never write the token to a repository, logs, or commits. Report the result when finished.` : "";

  if (loading) return <section className="auth-panel api-auth-panel">Restoring your account…</section>;
  if (!configured) return <section className="auth-panel api-auth-panel"><h1>Agent Upload API</h1><p>Firebase is not configured yet.</p></section>;
  if (!user) return <section className="auth-panel api-auth-panel"><h1>Agent Upload API</h1><p>Sign in to create or revoke upload tokens.</p><a className="primary-button login-link" href="/login/">Sign in with Google</a></section>;

  return <section className="skills-app">
    <h1>Agent Upload API</h1>
    <p>Create a time-limited token and give the instructions below to your agent. Tokens can only create skills and can be revoked at any time.</p>
    <section className="skill-editor">
      <h2>Create upload instructions</h2>
      <label htmlFor="token-hours">Token lifetime (hours)</label>
      <input id="token-hours" type="number" min={1} step={1} value={hours} onChange={(event) => setHours(Number(event.target.value))} />
      <p>Enter any positive whole number of hours. The expiration date must fall within Firestore&apos;s supported date range.</p>
      <div className="form-actions"><button className="primary-button" type="button" disabled={busy || !Number.isSafeInteger(hours) || hours < 1} onClick={() => void createToken()}>{busy ? "Working…" : "Generate token and instructions"}</button></div>
      {issued && <><label htmlFor="agent-prompt">Instructions for your agent (the secret is shown only once)</label><textarea id="agent-prompt" rows={9} readOnly value={prompt} /><div className="form-actions"><button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(prompt).then(() => setMessage("Instructions copied."))}>Copy instructions</button></div></>}
      <p className={`status${error ? " error" : ""}`} role="status" aria-live="polite">{error || message}</p>
    </section>
    <section className="skill-library" style={{ marginTop: 20 }}>
      <h2>Upload tokens</h2>
      {tokens.length === 0 ? <p>No tokens yet.</p> : <ul className="skill-list">{tokens.map((token) => <li className="skill-item" key={token.id}>
        <p>Created: {token.createdAt ? new Date(token.createdAt).toLocaleString("en-US") : "Just now"}</p><p>Expires: {new Date(token.expiresAt).toLocaleString("en-US")}</p><p>Status: {token.revoked ? "Revoked" : token.expired ? "Expired" : "Active"}</p>
        {!token.revoked && !token.expired && <button className="secondary-button danger-button" disabled={busy} type="button" onClick={() => void revoke(token.id)}>Revoke</button>}
      </li>)}</ul>}
    </section>
    <p><Link href="/">← Back to Skills Hub</Link></p>
  </section>;
}
