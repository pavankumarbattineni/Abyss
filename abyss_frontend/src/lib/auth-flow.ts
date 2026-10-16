import axios from "axios";
import { signInWithPopup, type User } from "firebase/auth";

import { authService } from "@/services";
import { firebaseAuth, googleProvider } from "@/lib/firebase";

/**
 * Exchanges a signed-in Firebase user for Abyss session tokens.
 *
 * If the exchange fails the Firebase session is signed out again, so a retry starts from a clean
 * state instead of leaving the browser half signed-in (Firebase-authenticated but without an Abyss
 * session).
 */
export async function exchangeFirebaseUser(user: User) {
  try {
    return await authService.loginWithFirebase(await user.getIdToken());
  } catch (error) {
    await firebaseAuth.signOut().catch(() => undefined);
    throw error;
  }
}

/** Opens the Google popup, then exchanges the resulting Firebase identity for Abyss tokens. */
export async function signInWithGoogle() {
  const result = await signInWithPopup(firebaseAuth, googleProvider);
  return exchangeFirebaseUser(result.user);
}

export interface AuthFeedback {
  message: string;
  /** "info" for user-initiated outcomes (e.g. closing the popup), "error" for real failures. */
  level: "info" | "error";
}

/**
 * Maps a Firebase or API failure from the sign-in / sign-up flows to a message that tells the user
 * what happened and what to do next.
 */
export function getAuthFeedback(error: unknown, fallback: string): AuthFeedback {
  // The Abyss API: unreachable (no response at all) vs. rejected the token.
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return {
        level: "error",
        message: "Can't reach the Abyss server. Check your connection and try again in a moment.",
      };
    }
    if (error.response.status === 401) {
      return {
        level: "error",
        message: "Your account was verified, but Abyss couldn't sign you in. Please try again.",
      };
    }
    return { level: "error", message: "Abyss ran into a problem signing you in. Please try again." };
  }

  switch ((error as { code?: string })?.code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return { level: "info", message: "Sign-in was cancelled." };
    case "auth/popup-blocked":
      return {
        level: "error",
        message: "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
      };
    case "auth/account-exists-with-different-credential":
      return {
        level: "error",
        message: "This email is already registered with a different sign-in method. Use your email and password instead.",
      };
    case "auth/unauthorized-domain":
      return {
        level: "error",
        message: "Google sign-in isn't enabled for this address. Contact an administrator.",
      };
    case "auth/operation-not-allowed":
      return { level: "error", message: "Google sign-in isn't enabled for this app. Contact an administrator." };
    case "auth/network-request-failed":
      return { level: "error", message: "Unable to reach Google. Check your connection and try again." };
    default:
      return { level: "error", message: fallback };
  }
}
