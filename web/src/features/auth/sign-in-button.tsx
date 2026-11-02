"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-provider";

export function SignInButton() {
  const { user, loading, configured, signIn } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/skills/");
  }, [loading, router, user]);

  async function handleSignIn() {
    setBusy(true);
    setError("");
    try {
      await signIn();
      router.replace("/skills/");
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code;
      const messages: Record<string, string> = {
        "auth/popup-closed-by-user": "Sign-in was cancelled. Try again when you're ready.",
        "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.",
        "auth/unauthorized-domain": "This site is not allowed to sign in yet. Ask the administrator to add its domain in Firebase Authentication settings.",
        "auth/operation-not-allowed": "Google sign-in is disabled for this Firebase project. Ask the administrator to enable the Google provider.",
      };
      setError(messages[code ?? ""] ?? "Could not sign in. Check your connection and try again.");
      setBusy(false);
    }
  }

  const message = error || (!configured
    ? "Sign-in is unavailable because this deployment is missing NEXT_PUBLIC_FIREBASE_CONFIG. Ask the site administrator to configure Firebase and redeploy."
    : loading
      ? "Restoring your account…"
      : "Your sign-in stays active as you move around the site.");

  return (
    <>
      <button className="primary-button" type="button" disabled={!configured || loading || busy || Boolean(user)} onClick={() => void handleSignIn()}>
        {busy ? "Opening Google sign-in…" : "Continue with Google"}
      </button>
      <p className={`status${error ? " error" : ""}`} role="status" aria-live="polite">{message}</p>
    </>
  );
}
