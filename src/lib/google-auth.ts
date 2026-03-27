import { google } from "googleapis";
import { cookies } from "next/headers";
import crypto from "crypto";

const SCOPES = ["https://www.googleapis.com/auth/gmail.compose"];
const COOKIE_NAME = "ff_gmail_tokens";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Simple AES encryption for storing tokens in cookies
function getEncryptionKey(): Buffer {
  // Use a stable key derived from client secret (always available)
  const secret = process.env.GOOGLE_CLIENT_SECRET || "fallback-secret-key";
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getEncryptionKey(), iv);
  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  return iv.toString("base64") + ":" + encrypted;
}

function decrypt(data: string): string {
  const [ivBase64, encrypted] = data.split(":");
  if (!ivBase64 || !encrypted) throw new Error("Invalid encrypted data");
  const iv = Buffer.from(ivBase64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-cbc", getEncryptionKey(), iv);
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  email?: string;
}

export function getOAuth2Client(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set as environment variables");
  }

  const uri =
    process.env.GOOGLE_REDIRECT_URI ||
    redirectUri ||
    "http://localhost:3001/api/auth/callback";

  return new google.auth.OAuth2(clientId, clientSecret, uri);
}

export function getAuthUrl(origin?: string): string {
  const redirectUri = origin ? origin + "/api/auth/callback" : undefined;
  const client = getOAuth2Client(redirectUri);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function handleCallback(code: string, origin?: string): Promise<StoredTokens> {
  const redirectUri = origin ? origin + "/api/auth/callback" : undefined;
  const client = getOAuth2Client(redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Get user email
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });

  const storedTokens: StoredTokens = {
    access_token: tokens.access_token || "",
    refresh_token: tokens.refresh_token || undefined,
    expiry_date: tokens.expiry_date || undefined,
    email: profile.data.emailAddress || undefined,
  };

  // Save tokens to encrypted cookie
  await saveTokensToCookie(storedTokens);

  return storedTokens;
}

async function saveTokensToCookie(tokens: StoredTokens) {
  const cookieStore = await cookies();
  const encrypted = encrypt(JSON.stringify(tokens));
  cookieStore.set(COOKIE_NAME, encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function getStoredTokens(): Promise<StoredTokens | null> {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(COOKIE_NAME);
    if (!cookie?.value) return null;

    const decrypted = decrypt(cookie.value);
    const tokens: StoredTokens = JSON.parse(decrypted);

    // Check if access token exists
    if (!tokens.access_token) return null;

    return tokens;
  } catch {
    return null;
  }
}

export async function clearTokens() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getAuthenticatedClient() {
  const tokens = await getStoredTokens();
  if (!tokens?.access_token) return null;

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  });

  // If token is expired and we have a refresh token, refresh it
  if (tokens.expiry_date && Date.now() > tokens.expiry_date && tokens.refresh_token) {
    try {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);

      // Save refreshed tokens
      const updatedTokens: StoredTokens = {
        access_token: credentials.access_token || tokens.access_token,
        refresh_token: credentials.refresh_token || tokens.refresh_token,
        expiry_date: credentials.expiry_date || undefined,
        email: tokens.email,
      };
      await saveTokensToCookie(updatedTokens);
    } catch {
      // Refresh failed — clear tokens
      await clearTokens();
      return null;
    }
  }

  return client;
}
