import type { Metadata } from "next";
import { SkillsWorkspace } from "@/features/private-skills/skills-workspace";

export const metadata: Metadata = { title: "Skills Hub — agentic-swe" };

export default function SkillsPage() {
  return <SkillsWorkspace />;
}
