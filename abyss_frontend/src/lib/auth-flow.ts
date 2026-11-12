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
export async function exchangeFirebaseUser(user: User, forceRefresh = false) {
  try {
    // forceRefresh: a profile change (e.g. the display name set at sign-up)
    // only reaches the ID token's claims once it is re-issued.
    return await authService.loginWithFirebase(await user.getIdToken(forceRefresh));
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
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return { level: "error", message: "The email or password is incorrect." };
    case "auth/invalid-email":
      return { level: "error", message: "That email address isn't valid." };
    case "auth/user-disabled":
      return { level: "error", message: "This account has been disabled. Contact an administrator." };
    case "auth/email-already-in-use":
      return { level: "error", message: "An account with this email already exists. Sign in instead." };
    case "auth/weak-password":
      return { level: "error", message: "Choose a stronger password (at least 8 characters)." };
    case "auth/too-many-requests":
      return { level: "error", message: "Too many attempts. Wait a few minutes and try again." };
    case "auth/account-exists-with-different-credential":
      return {
        level: "error",
        message: "This email is already registered with a different sign-in method. Use your email and password instead.",
      };
    case "auth/unauthorized-domain":
      return { level: "error", message: "Sign-in isn't enabled for this address. Contact an administrator." };
    case "auth/operation-not-allowed":
      // Also what Firebase returns when email/password sign-in is switched off.
      return {
        level: "error",
        message: "This sign-in method isn't enabled for Abyss. Use another method or contact an administrator.",
      };
    case "auth/network-request-failed":
      return { level: "error", message: "Can't reach the sign-in service. Check your connection and try again." };
    default:
      return { level: "error", message: fallback };
  }
}
