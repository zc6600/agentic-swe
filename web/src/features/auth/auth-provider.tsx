"use client";

import {
  browserLocalPersistence,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { getFirebaseClient } from "@/lib/firebase/client";

type AuthSnapshot = {
  user: User | null;
  loading: boolean;
  configured: boolean;
};

const initialSnapshot: AuthSnapshot = { user: null, loading: true, configured: false };
let snapshot = initialSnapshot;
let activeAuth: Auth | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return initialSnapshot;
}

function publish(nextSnapshot: AuthSnapshot) {
  snapshot = nextSnapshot;
  listeners.forEach((listener) => listener());
}

export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const client = getFirebaseClient();
    if (!client) {
      publish({ user: null, loading: false, configured: false });
      return;
    }

    let active = true;
    let unsubscribe = () => {};
    activeAuth = client.auth;
    publish({ ...snapshot, loading: true, configured: true });

    unsubscribe = onAuthStateChanged(client.auth, (user) => {
      publish({ user, loading: false, configured: true });
    }, (error) => {
      console.error("Could not restore the saved sign-in state.", error);
      if (active) publish({ user: null, loading: false, configured: true });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return children;
}

export function useAuth() {
  const authState = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    ...authState,
    async signIn() {
      if (!activeAuth) throw new Error("Sign-in is not configured yet.");
      await setPersistence(activeAuth, browserLocalPersistence);
      await signInWithPopup(activeAuth, new GoogleAuthProvider());
    },
    async signOut() {
      if (activeAuth) await firebaseSignOut(activeAuth);
    },
  };
}
