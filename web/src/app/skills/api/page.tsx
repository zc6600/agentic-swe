import type { Metadata } from "next";
import { SkillApiAccess } from "@/features/private-skills/skill-api-access";

export const metadata: Metadata = { title: "Agent Skill API — agentic-swe" };

export default function SkillApiPage() {
  return (
    <>
      <SkillApiAccess />
      <details>
        <summary>HTTP Endpoint Reference</summary>
        <pre className="api-example">{`POST https://asia-southeast1-agentic-swe-skills.cloudfunctions.net/uploadSkill
Authorization: Bearer <temporary-token>
Content-Type: application/json

{"title":"my-skill","slug":"my-skill","visibility":"private","description":"...","content":"..."}`}</pre>
      </details>
    </>
  );
}
