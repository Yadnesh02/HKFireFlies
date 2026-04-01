import { NextRequest } from "next/server";
import { google } from "googleapis";
import { getOAuth2Client } from "@/lib/google-auth";

export async function POST(request: NextRequest) {
  try {
    const { subject, body, to, cc, tokens } = await request.json();

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

    // Proactively refresh if token is expired or close to expiring (within 5 min buffer)
    let updatedTokens = null;
    const FIVE_MIN = 5 * 60 * 1000;
    const isExpired = tokens.expiry_date && Date.now() > (tokens.expiry_date - FIVE_MIN);
    if (isExpired && tokens.refresh_token) {
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

    // Thorough markdown stripping for clean plain-text Gmail draft
    const cleanBody = body
      // Bold+italic: ***text***
      .replace(/\*{3,}([\s\S]+?)\*{3,}/g, "$1")
      // Bold: **text** (multiline-safe)
      .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
      // Italic: *text* (single line only, avoid matching bullet lists)
      .replace(/([^*])\*([^*\n]+?)\*([^*])/g, "$1$2$3")
      // Stray leading/trailing asterisks on lines
      .replace(/^\*{1,3}\s*/gm, "")
      .replace(/\s*\*{1,3}$/gm, "")
      // Any remaining standalone asterisks (not part of bullet points)
      .replace(/(\S)\*+(\S)/g, "$1$2")
      // Headers: # ## ###
      .replace(/^#{1,3}\s+/gm, "")
      // Bullet points: normalize - or • to clean dashes
      .replace(/^\s*[•]\s+/gm, "- ")
      // Strikethrough
      .replace(/~~(.+?)~~/g, "$1")
      // Inline code
      .replace(/`(.+?)`/g, "$1")
      // Links: [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Underscores used as separators or emphasis
      .replace(/_{2,}/g, "")
      .replace(/(\S)_([^_\n]+?)_(\S)/g, "$1$2$3")
      // Horizontal rules
      .replace(/^---+$/gm, "---")
      // Special characters that don't belong in email
      .replace(/[\u20AC\u2122\u00A9\u00AE\u2020\u2021\u00A7\u00B6]/g, "")
      .replace(/\u200B/g, "")
      .replace(/\u00A0/g, " ")
      // Clean up excessive blank lines (max 2 consecutive)
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();

    const cleanSubject = (subject || "")
      .replace(/\*+/g, "")
      .replace(/#{1,3}\s*/g, "")
      .replace(/_+/g, "")
      .trim();

    const gmail = google.gmail({ version: "v1", auth: client });

    // Build RFC 2822 email message
    const messageParts = [
      'Content-Type: text/plain; charset="UTF-8"',
      "MIME-Version: 1.0",
    ];
    if (to) messageParts.push("To: " + to);
    if (cc) {
      const ccList = Array.isArray(cc) ? cc.join(", ") : cc;
      if (ccList) messageParts.push("Cc: " + ccList);
    }
    if (cleanSubject) messageParts.push("Subject: " + cleanSubject);
    messageParts.push("", cleanBody);

    const rawMessage = messageParts.join("\r\n");

    const encoded = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Attempt to create draft, with one retry on auth failure
    let draft;
    try {
      draft = await gmail.users.drafts.create({
        userId: "me",
        requestBody: { message: { raw: encoded } },
      });
    } catch (createErr: any) {
      // If 401 and we have a refresh token, try refreshing and retrying once
      if ((createErr.code === 401 || createErr.message?.includes("invalid_grant")) && tokens.refresh_token) {
        try {
          const { credentials } = await client.refreshAccessToken();
          client.setCredentials(credentials);
          updatedTokens = {
            access_token: credentials.access_token || tokens.access_token,
            refresh_token: credentials.refresh_token || tokens.refresh_token,
            expiry_date: credentials.expiry_date || tokens.expiry_date,
            email: tokens.email,
          };

          const retryGmail = google.gmail({ version: "v1", auth: client });
          draft = await retryGmail.users.drafts.create({
            userId: "me",
            requestBody: { message: { raw: encoded } },
          });
        } catch {
          return Response.json(
            { error: "Gmail session expired. Please reconnect your Gmail." },
            { status: 401 }
          );
        }
      } else {
        throw createErr;
      }
    }

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
