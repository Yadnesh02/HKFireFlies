import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/gmail.compose"];

// In-memory token store (per-process). For production, use a database.
let storedTokens: {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  email?: string;
} | null = null;

export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/auth/callback";

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env.local");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function handleCallback(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Get user email
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });

  storedTokens = {
    access_token: tokens.access_token || "",
    refresh_token: tokens.refresh_token || undefined,
    expiry_date: tokens.expiry_date || undefined,
    email: profile.data.emailAddress || undefined,
  };

  return storedTokens;
}

export function getStoredTokens() {
  return storedTokens;
}

export function clearTokens() {
  storedTokens = null;
}

export function getAuthenticatedClient() {
  if (!storedTokens?.access_token) {
    return null;
  }

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: storedTokens.access_token,
    refresh_token: storedTokens.refresh_token,
    expiry_date: storedTokens.expiry_date,
  });

  return client;
}
