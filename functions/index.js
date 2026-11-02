const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");

initializeApp();
const db = getFirestore();
const REGION = "asia-southeast1";
// Firestore Timestamps support dates through 9999-12-31.
const MAX_EXPIRES_AT_MS = 253402300799999;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function slugify(input) {
  const slug = String(input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "skill";
}

function userTokens(uid) {
  return db.collection("users").doc(uid).collection("skillUploadTokens");
}

async function resolveBearerTokenOwner(authHeader) {
  const match = String(authHeader ?? "").match(/^Bearer (ask_[0-9a-f-]{36}\.[A-Za-z0-9_-]{40,})$/i);
  if (!match) return { error: "invalid_token" };
  const token = match[1];
  const tokenId = token.slice(4).split(".")[0];

  const matches = await db.collectionGroup("skillUploadTokens").where("tokenHash", "==", hashToken(token)).limit(1).get();
  if (matches.empty) return { error: "invalid_token" };
  const tokenRef = matches.docs[0];
  const ownerUid = tokenRef.ref.parent.parent?.id;
  const tokenData = tokenRef.data();
  if (!ownerUid || tokenRef.id !== tokenId || tokenData.scope !== "skills:create" || tokenData.revokedAt || tokenData.expiresAt.toMillis() <= Date.now()) {
    return { error: "expired_or_revoked_token" };
  }
  return { ownerUid };
}

exports.createSkillUploadToken = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const hours = Number(request.data?.hours);
  const expiresAtMs = Date.now() + hours * 60 * 60 * 1000;
  if (!Number.isSafeInteger(hours) || hours < 1 || !Number.isFinite(expiresAtMs) || expiresAtMs > MAX_EXPIRES_AT_MS) {
    throw new HttpsError("invalid-argument", "hours must be a positive whole number within Firestore's supported date range.");
  }

  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const token = `ask_${id}.${secret}`;
  const expiresAt = Timestamp.fromMillis(expiresAtMs);
  await userTokens(request.auth.uid).doc(id).create({
    tokenHash: hashToken(token),
    scope: "skills:create",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    revokedAt: null,
  });

  return { id, token, expiresAt: expiresAt.toDate().toISOString() };
});

exports.listSkillUploadTokens = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const snapshot = await userTokens(request.auth.uid).orderBy("createdAt", "desc").limit(50).get();
  return {
    tokens: snapshot.docs.map((doc) => ({
      id: doc.id,
      createdAt: doc.get("createdAt")?.toDate().toISOString() ?? null,
      expiresAt: doc.get("expiresAt").toDate().toISOString(),
      revoked: Boolean(doc.get("revokedAt")),
    })),
  };
});

exports.revokeSkillUploadToken = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const id = String(request.data?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpsError("invalid-argument", "Invalid token id.");
  const ref = userTokens(request.auth.uid).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new HttpsError("not-found", "Token not found.");
  await ref.update({ revokedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

exports.uploadSkill = onRequest({ region: REGION, cors: true, maxInstances: 10 }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const resolved = await resolveBearerTokenOwner(req.get("Authorization"));
  if (resolved.error) return res.status(401).json({ error: resolved.error });
  const { ownerUid } = resolved;

  const { title, slug: rawSlug, description = "", content, visibility = "private", ownerHandle } = req.body ?? {};
  if (
    typeof title !== "string" || !title.trim() || title.length > 100 ||
    typeof description !== "string" || description.length > 500 ||
    typeof content !== "string" || !content.trim() || content.length > 100000 ||
    !["private", "public"].includes(visibility)
  ) {
    return res.status(400).json({
      error: "invalid_skill",
      message: "Expected title (1-100 chars), description (0-500 chars), content (1-100000 chars), and optional visibility ('private' | 'public').",
    });
  }

  const cleanTitle = title.trim();
  const slug = slugify(typeof rawSlug === "string" && rawSlug.trim() ? rawSlug : cleanTitle);
  const skillPayload = {
    title: cleanTitle,
    slug,
    description: description.trim(),
    content: content.trim(),
    visibility,
    ownerUid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (typeof ownerHandle === "string" && ownerHandle.trim()) {
    skillPayload.ownerHandle = ownerHandle.trim().slice(0, 60);
  }

  const skillsCol = db.collection("users").doc(ownerUid).collection("skills");
  const existing = await skillsCol.where("slug", "==", slug).limit(1).get();
  if (!existing.empty) {
    const docRef = existing.docs[0].ref;
    await docRef.update(skillPayload);
    return res.status(200).json({ id: docRef.id, slug, title: cleanTitle, updated: true });
  }

  const created = await skillsCol.add({
    ...skillPayload,
    createdAt: FieldValue.serverTimestamp(),
  });
  return res.status(201).json({ id: created.id, slug, title: cleanTitle, created: true });
});

exports.getRawSkill = onRequest({ region: REGION, cors: true, maxInstances: 10 }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  const slug = String(req.query.slug ?? "").trim();
  const owner = String(req.query.owner ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!slug) {
    return res.status(400).send("Provide ?slug=<skill-slug> and optionally &owner=<handle>.");
  }

  const matches = await db.collectionGroup("skills").where("slug", "==", slug).limit(25).get();
  let candidates = matches.docs;
  if (owner) {
    candidates = candidates.filter((d) => String(d.get("ownerHandle") ?? "").toLowerCase() === owner);
  }
  if (candidates.length === 0) return res.status(404).send("Skill not found.");

  // Public skills are served to anyone; private ones only to the owner's valid token.
  let docSnap = candidates.find((d) => d.get("visibility") === "public") ?? null;
  if (!docSnap) {
    const resolved = await resolveBearerTokenOwner(req.get("Authorization"));
    if (resolved.error) return res.status(403).send("Private skill requires a valid owner Bearer token.");
    docSnap = candidates.find((d) => d.ref.parent.parent?.id === resolved.ownerUid) ?? null;
    if (!docSnap) return res.status(404).send("Skill not found.");
  }

  const data = docSnap.data();

  let body = String(data.content ?? "");
  body = body.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)(?::([^}]*))?\s*\}\}/g, (_full, name, fallback) => {
    const queryVal = req.query[name];
    if (typeof queryVal === "string" && queryVal.trim()) return queryVal.trim();
    return typeof fallback === "string" && fallback.trim() ? fallback.trim() : `{{${name}}}`;
  });

  const frontmatter = [
    "---",
    `id: ${JSON.stringify(docSnap.id)}`,
    `name: ${JSON.stringify(data.title ?? "")}`,
    `slug: ${JSON.stringify(data.slug ?? slugify(data.title))}`,
    `description: ${JSON.stringify(data.description ?? "")}`,
    "---",
    "",
  ].join("\n");

  res.set("Content-Type", "text/markdown; charset=utf-8");
  return res.status(200).send(`${frontmatter}${body.trim()}\n`);
});
