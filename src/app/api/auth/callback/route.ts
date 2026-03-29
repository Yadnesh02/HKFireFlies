import { NextRequest } from "next/server";
import { getOAuth2Client } from "@/lib/google-auth";
import { google } from "googleapis";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const origin = request.nextUrl.origin;

  if (error) {
    return Response.redirect(origin + "/?auth_error=" + encodeURIComponent(error));
  }

  if (!code) {
    return new Response("No authorization code received", { status: 400 });
  }

  try {
    const redirectUri = origin + "/api/auth/callback";
    const client = getOAuth2Client(redirectUri);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Get user email
    const gmail = google.gmail({ version: "v1", auth: client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const email = profile.data.emailAddress || "";

    // Build token data to pass to client via postMessage
    const tokenData = JSON.stringify({
      access_token: tokens.access_token || "",
      refresh_token: tokens.refresh_token || "",
      expiry_date: tokens.expiry_date || 0,
      email: email,
    });

    // Return an HTML page that stores tokens in localStorage and redirects
    const html = `<!DOCTYPE html>
<html>
<head><title>Connecting Gmail...</title></head>
<body style="background:#0a0e1a;color:#06b6d4;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;margin:0">
<div style="text-align:center">
<p style="font-size:18px">Gmail connected successfully!</p>
<p style="font-size:14px;color:#666">Redirecting...</p>
</div>
<script>
try {
  var tokenData = ${tokenData};
  localStorage.setItem('ff_gmail_tokens', JSON.stringify(tokenData));
  window.location.href = '/?auth_success=true&email=' + encodeURIComponent(tokenData.email);
} catch(e) {
  window.location.href = '/?auth_error=' + encodeURIComponent(e.message);
}
</script>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  } catch (err: any) {
    console.error("OAuth callback error:", err);
    return Response.redirect(origin + "/?auth_error=" + encodeURIComponent(err.message));
  }
}
