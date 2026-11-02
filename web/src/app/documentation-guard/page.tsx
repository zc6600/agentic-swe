import type { Metadata } from "next";
import DocumentationGuardGuide from "@/content/documentation-guard.mdx";

export const metadata: Metadata = { title: "Documentation Guard" };

export default function DocumentationGuardPage() {
  return <DocumentationGuardGuide />;
}
