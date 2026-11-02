import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase/client";
import { slugifySkillName } from "@/features/private-skills/skill-file";

export type SkillVisibility = "private" | "public";

export type Skill = {
  id: string;
  title: string;
  slug?: string;
  description: string;
  content: string;
  visibility?: SkillVisibility;
  ownerHandle?: string;
  ownerUid?: string;
  official?: boolean;
  files?: Record<string, string>;
};

export type SkillInput = {
  title: string;
  slug?: string;
  description: string;
  content: string;
  visibility?: SkillVisibility;
  ownerHandle?: string;
};

export function deriveUserHandle(displayName?: string | null, email?: string | null): string {
  const base = (displayName || email?.split("@")[0] || "user").trim();
  const handle = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return handle || "user";
}

function getSkillsCollection(uid: string) {
  const client = getFirebaseClient();
  if (!client) throw new Error("Firebase is not configured.");
  return collection(getFirestore(client.app), "users", uid, "skills");
}

function normalizeSkillDoc(id: string, data: Record<string, unknown>, fallbackOwnerUid?: string): Skill {
  const title = typeof data.title === "string" ? data.title : "Untitled skill";
  const slug = typeof data.slug === "string" && data.slug ? data.slug : slugifySkillName(title);
  const visibility: SkillVisibility = data.visibility === "public" ? "public" : "private";
  const ownerHandle = typeof data.ownerHandle === "string" && data.ownerHandle ? data.ownerHandle : undefined;

  return {
    id,
    title,
    slug,
    description: typeof data.description === "string" ? data.description : "",
    content: typeof data.content === "string" ? data.content : "",
    visibility,
    ownerHandle,
    ownerUid: fallbackOwnerUid,
  };
}

export function subscribeToSkills(
  uid: string,
  onSkills: (skills: Skill[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const skills = query(getSkillsCollection(uid), orderBy("updatedAt", "desc"));
  return onSnapshot(
    skills,
    (snapshot) =>
      onSkills(
        snapshot.docs.map((item) =>
          normalizeSkillDoc(item.id, item.data() as Record<string, unknown>, uid),
        ),
      ),
    (error) => onError(error),
  );
}

export function subscribeToPublicSkills(
  onSkills: (skills: Skill[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const client = getFirebaseClient();
  if (!client) {
    onSkills([]);
    return () => {};
  }
  const db = getFirestore(client.app);
  const publicQuery = query(
    collectionGroup(db, "skills"),
    where("visibility", "==", "public"),
    limit(40),
  );
  return onSnapshot(
    publicQuery,
    (snapshot) =>
      onSkills(
        snapshot.docs.map((item) => {
          const parentUid = item.ref.parent.parent?.id;
          return normalizeSkillDoc(item.id, item.data() as Record<string, unknown>, parentUid);
        }),
      ),
    (error) => {
      onSkills([]);
      onError?.(error);
    },
  );
}

function buildSkillPayload(uid: string, values: SkillInput, defaultHandle?: string) {
  const title = values.title.trim();
  const slug = slugifySkillName(values.slug?.trim() || title);
  const visibility: SkillVisibility = values.visibility === "public" ? "public" : "private";
  const ownerHandle = (values.ownerHandle || defaultHandle || "").trim().slice(0, 60);

  const payload: Record<string, unknown> = {
    title,
    slug,
    description: values.description.trim(),
    content: values.content.trim(),
    visibility,
    ownerUid: uid,
  };
  if (ownerHandle) {
    payload.ownerHandle = ownerHandle;
  }
  return payload;
}

export async function createSkill(uid: string, values: SkillInput, defaultHandle?: string) {
  const created = await addDoc(getSkillsCollection(uid), {
    ...buildSkillPayload(uid, values, defaultHandle),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return created.id;
}

export async function updateSkill(uid: string, id: string, values: SkillInput, defaultHandle?: string) {
  const client = getFirebaseClient();
  if (!client) throw new Error("Firebase is not configured.");
  await updateDoc(doc(getFirestore(client.app), "users", uid, "skills", id), {
    ...buildSkillPayload(uid, values, defaultHandle),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSkill(uid: string, id: string) {
  const client = getFirebaseClient();
  if (!client) throw new Error("Firebase is not configured.");
  await deleteDoc(doc(getFirestore(client.app), "users", uid, "skills", id));
}
