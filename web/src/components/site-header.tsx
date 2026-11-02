"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/features/auth/auth-provider";

export function SiteHeader() {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname();

  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">a</span>
        <span>agentic-swe</span>
      </Link>
      <nav className="topnav" aria-label="Main navigation">
        <Link href="/" aria-current={pathname === "/" || pathname === "/skills/" ? "page" : undefined}>
          Skills Hub
        </Link>
        <Link href="/skills/api/" aria-current={pathname === "/skills/api/" ? "page" : undefined}>
          Agent API
        </Link>
        <a className="github-link" href="https://github.com/zc6600/agentic-swe" target="_blank" rel="noreferrer">
          GitHub <span aria-hidden="true">↗</span>
        </a>
        {loading ? (
          <span className="account-placeholder" aria-label="Restoring account">…</span>
        ) : user ? (
          <details className="account-menu">
            <summary className="account-link">
              {user.photoURL?.startsWith("https://") ? (
                <Image className="account-avatar account-avatar-photo" src={user.photoURL} alt="" width={26} height={26} unoptimized />
              ) : (
                <span className="account-avatar" aria-hidden="true">
                  {(user.displayName || user.email || "A").trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span className="account-name">{user.displayName?.split(/\s+/)[0] || "Account"}</span>
            </summary>
            <div className="account-popover">
              <p>{user.email}</p>
              <Link href="/skills/api/">Upload Tokens</Link>
              <button type="button" onClick={() => void signOut()}>Sign out</button>
            </div>
          </details>
        ) : (
          <Link className="account-link" href="/login/">Sign in</Link>
        )}
      </nav>
    </header>
  );
}
