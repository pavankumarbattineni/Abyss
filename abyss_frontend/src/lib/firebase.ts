import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
  throw new Error("Missing Firebase web configuration. Check .env.local.");
}

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

// Local testing only: set NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL (e.g. http://127.0.0.1:9099) to
// sign in against the Firebase Auth Emulator instead of the real project. Unset in normal use.
const emulatorUrl = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL;
if (emulatorUrl && !firebaseAuth.emulatorConfig) {
  connectAuthEmulator(firebaseAuth, emulatorUrl, { disableWarnings: true });
}

export const googleProvider = new GoogleAuthProvider();
// Always show the account chooser so users with several Google accounts can pick the right one.
googleProvider.setCustomParameters({ prompt: "select_account" });
