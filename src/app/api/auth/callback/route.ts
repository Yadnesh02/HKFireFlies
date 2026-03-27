import { NextRequest } from "next/server";
import { handleCallback } from "@/lib/google-auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    // User denied access — redirect back with error
    const base = request.nextUrl.origin;
    return Response.redirect(base + "/?auth_error=" + encodeURIComponent(error));
  }

  if (!code) {
    return Response.json({ error: "No authorization code received" }, { status: 400 });
  }

  try {
    const tokens = await handleCallback(code);
    // Redirect back to app with success
    const base = request.nextUrl.origin;
    return Response.redirect(base + "/?auth_success=true&email=" + encodeURIComponent(tokens.email || ""));
  } catch (err: any) {
    console.error("OAuth callback error:", err);
    const base = request.nextUrl.origin;
    return Response.redirect(base + "/?auth_error=" + encodeURIComponent(err.message));
  }
}
