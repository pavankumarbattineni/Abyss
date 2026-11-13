import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";

import { api } from "@/lib/axios";
import { firebaseAuth, googleProvider } from "@/lib/firebase";
import type { DeleteAccountRequest, Profile, UpdateProfileRequest } from "@/types";

class ProfileService {
  async get(): Promise<Profile> {
    const { data } = await api.get<Profile>("/profile");
    return data;
  }

  async update(payload: UpdateProfileRequest): Promise<Profile> {
    const { data } = await api.patch<Profile>("/profile", payload);
    return data;
  }

  async deleteAccount(payload: DeleteAccountRequest): Promise<void> {
    await api.delete("/profile", { data: payload });
  }

  /**
   * Has the user sign in again (Google popup or password) and returns a fresh
   * Firebase ID token -- the proof a deletion needs that the account owner is
   * here right now.
   */
  async confirmIdentity(
    method: "google" | "password",
    email: string,
    password?: string,
  ): Promise<string> {
    const current = firebaseAuth.currentUser;
    const sameUser = current?.email?.toLowerCase() === email.toLowerCase() ? current : null;
    if (method === "password") {
      const credential = EmailAuthProvider.credential(email, password ?? "");
      const result = sameUser
        ? await reauthenticateWithCredential(sameUser, credential)
        : await signInWithEmailAndPassword(firebaseAuth, email, password ?? "");
      return result.user.getIdToken(true);
    }
    const result = sameUser
      ? await reauthenticateWithPopup(sameUser, googleProvider)
      : await signInWithPopup(firebaseAuth, googleProvider);
    return result.user.getIdToken(true);
  }
}

export const profileService = new ProfileService();
