"use client";

import type { ReactNode } from "react";
import { CopyCodeButtons } from "@/components/copy-code-buttons";
import { SiteHeader } from "@/components/site-header";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="main-container doc-content">{children}</main>
      <footer className="footer">
        <div className="footer-inner">
          <span>
            <a href="https://github.com/zc6600/agentic-swe">Open source on GitHub</a>
          </span>
          <span>agentic-swe</span>
        </div>
      </footer>
      <CopyCodeButtons />
    </>
  );
}
