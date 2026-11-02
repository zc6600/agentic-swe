import type { Metadata } from "next";
import { SignInButton } from "@/features/auth/sign-in-button";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <section className="auth-panel">
      <h1>Sign in to agentic-swe</h1>
      <p>Manage your private skills. Only your account can read or change them.</p>
      <SignInButton />
    </section>
  );
}
