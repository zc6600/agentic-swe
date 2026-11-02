import type { Metadata } from "next";
import PrAgentGuide from "@/content/pr-agent.mdx";

export const metadata: Metadata = { title: "PR Agent" };

export default function PrAgentPage() {
  return <PrAgentGuide />;
}
