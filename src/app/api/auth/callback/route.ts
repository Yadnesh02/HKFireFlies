import { NextRequest } from "next/server";
import { handleCallback } from "@/lib/google-auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const origin = request.nextUrl.origin;

  if (error) {
    return Response.redirect(origin + "/?auth_error=" + encodeURIComponent(error));
  }

  if (!code) {
    return Response.json({ error: "No authorization code received" }, { status: 400 });
  }

  try {
    const tokens = await handleCallback(code, origin);
    return Response.redirect(origin + "/?auth_success=true&email=" + encodeURIComponent(tokens.email || ""));
  } catch (err: any) {
    console.error("OAuth callback error:", err);
    return Response.redirect(origin + "/?auth_error=" + encodeURIComponent(err.message));
  }
}
