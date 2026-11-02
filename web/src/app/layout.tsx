import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/features/auth/auth-provider";
import { SiteShell } from "@/components/site-shell";

export const metadata: Metadata = {
  title: { default: "agentic-swe", template: "%s · agentic-swe" },
  description: "Reusable GitHub Actions and tools for agent-assisted software development.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <SiteShell>{children}</SiteShell>
        </AuthProvider>
      </body>
    </html>
  );
}
