import { getStoredTokens, clearTokens } from "@/lib/google-auth";

export async function GET() {
  try {
    const tokens = await getStoredTokens();
    if (tokens?.access_token) {
      return Response.json({
        authenticated: true,
        email: tokens.email || null,
      });
    }
    return Response.json({ authenticated: false });
  } catch {
    return Response.json({ authenticated: false });
  }
}

export async function DELETE() {
  await clearTokens();
  return Response.json({ success: true });
}
