import { NextRequest } from "next/server";
import { google } from "googleapis";
import { getOAuth2Client } from "@/lib/google-auth";

export async function POST(request: NextRequest) {
  try {
    const { subject, body, to, tokens } = await request.json();

    if (!body) {
      return Response.json({ error: "Email body is required" }, { status: 400 });
    }

    if (!tokens?.access_token) {
      return Response.json(
        { error: "Not authenticated. Please connect your Gmail first." },
        { status: 401 }
      );
    }

    // Create OAuth client from client-provided tokens
    const client = getOAuth2Client();
    client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || undefined,
      expiry_date: tokens.expiry_date || undefined,
    });

    // If token is expired, try refreshing
    let updatedTokens = null;
    if (tokens.expiry_date && Date.now() > tokens.expiry_date && tokens.refresh_token) {
      try {
        const { credentials } = await client.refreshAccessToken();
        client.setCredentials(credentials);
        updatedTokens = {
          access_token: credentials.access_token || tokens.access_token,
          refresh_token: credentials.refresh_token || tokens.refresh_token,
          expiry_date: credentials.expiry_date || tokens.expiry_date,
          email: tokens.email,
        };
      } catch {
        return Response.json(
          { error: "Gmail session expired. Please reconnect your Gmail." },
          { status: 401 }
        );
      }
    }

    // Strip all markdown formatting for clean plain-text email
    const cleanBody = body
      .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/^#{1,3}\s+/gm, "")
      .replace(/^\s*[-\u2022]\s+/gm, "- ")
      .replace(/_{2,}/g, "")
      .replace(/~~/g, "")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[\u20AC\u2122\u00A9\u00AE\u2020\u2021\u00A7\u00B6]/g, "")
      .replace(/\u200B/g, "")
      .replace(/---+/g, "---");

    const cleanSubject = (subject || "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/#{1,3}\s*/g, "");

    const gmail = google.gmail({ version: "v1", auth: client });

    // Build RFC 2822 email message
    const messageParts = [
      'Content-Type: text/plain; charset="UTF-8"',
      "MIME-Version: 1.0",
    ];
    if (to) messageParts.push("To: " + to);
    if (cleanSubject) messageParts.push("Subject: " + cleanSubject);
    messageParts.push("", cleanBody);

    const rawMessage = messageParts.join("\r\n");

    const encoded = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const draft = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { raw: encoded },
      },
    });

    return Response.json({
      success: true,
      draftId: draft.data.id,
      message: "Draft saved to Gmail",
      updatedTokens: updatedTokens,
    });
  } catch (error: any) {
    console.error("Draft save error:", error);

    if (error.code === 401 || error.message?.includes("invalid_grant")) {
      return Response.json(
        { error: "Gmail session expired. Please reconnect your Gmail." },
        { status: 401 }
      );
    }

    return Response.json(
      { error: error.message || "Failed to save draft" },
      { status: 500 }
    );
  }
}
