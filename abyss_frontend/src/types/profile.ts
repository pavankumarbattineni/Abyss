export interface ProfileStats {
  agents: number;
  threads: number;
  mcp_servers: number;
  api_keys: number;
  provider_keys: number;
}

/** Firebase sign-in providers: "google.com", "password". */
export type SignInMethod = "google.com" | "password" | string;

export interface Profile {
  id: string;
  username: string | null;
  email: string;
  created_at: string;
  sign_in_methods: SignInMethod[];
  stats: ProfileStats;
}

export interface UpdateProfileRequest {
  username: string;
}

export interface DeleteAccountRequest {
  /** The account's email, typed by the user. */
  confirm_email: string;
  /** A Firebase ID token from a sign-in made just now. */
  id_token: string;
}
