import { getStoredTokens, clearTokens } from "@/lib/google-auth";
import { NextRequest } from "next/server";

export async function GET() {
  const tokens = getStoredTokens();
  if (tokens?.access_token) {
    return Response.json({
      authenticated: true,
      email: tokens.email || null,
    });
  }
  return Response.json({ authenticated: false });
}

export async function DELETE(_request: NextRequest) {
  clearTokens();
  return Response.json({ success: true });
}
