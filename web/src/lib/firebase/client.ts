import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

export type FirebaseClient = {
  app: FirebaseApp;
  auth: Auth;
};

let firebaseClient: FirebaseClient | null | undefined;

export function getFirebaseClient(): FirebaseClient | null {
  if (typeof window === "undefined") return null;
  if (firebaseClient !== undefined) return firebaseClient;

  const rawConfig = process.env.NEXT_PUBLIC_FIREBASE_CONFIG;
  if (!rawConfig) {
    firebaseClient = null;
    return firebaseClient;
  }

  try {
    const parsedConfig = JSON.parse(rawConfig) as Record<string, unknown>;
    if (!["apiKey", "authDomain", "projectId", "appId"].every((key) => typeof parsedConfig[key] === "string")) {
      throw new Error("Firebase web config is missing required values.");
    }

    const config = parsedConfig as FirebaseOptions;
    const app = getApps().length ? getApp() : initializeApp(config);
    firebaseClient = { app, auth: getAuth(app) };
    return firebaseClient;
  } catch (error) {
    console.error("Firebase configuration could not be loaded.", error);
    firebaseClient = null;
    return firebaseClient;
  }
}
