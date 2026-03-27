import { NextRequest } from "next/server";
import { google } from "googleapis";
import { getAuthenticatedClient } from "@/lib/google-auth";

export async function POST(request: NextRequest) {
  try {
    const client = await getAuthenticatedClient();
    if (!client) {
      return Response.json(
        { error: "Not authenticated. Please connect your Gmail first." },
        { status: 401 }
      );
    }

    const { subject, body, to } = await request.json();
    if (!body) {
      return Response.json({ error: "Email body is required" }, { status: 400 });
    }

    // Strip all markdown formatting for clean plain-text email
    const cleanBody = body
      .replace(/\*\*\*(.+?)\*\*\*/g, "$1")   // ***bold italic*** → text
      .replace(/\*\*(.+?)\*\*/g, "$1")        // **bold** → text
      .replace(/\*(.+?)\*/g, "$1")            // *italic* → text
      .replace(/^#{1,3}\s+/gm, "")            // ### headers → text
      .replace(/^\s*[-•]\s+/gm, "- ")         // normalize bullets
      .replace(/_{2,}/g, "")                   // __ underscores
      .replace(/~~/g, "")                      // ~~ strikethrough
      .replace(/`(.+?)`/g, "$1")              // `code` → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [link](url) → link text
      .replace(/[€™©®†‡§¶]/g, "")            // special chars
      .replace(/\u200B/g, "")                  // zero-width space
      .replace(/---+/g, "---");               // keep simple hr

    const cleanSubject = (subject || "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/#{1,3}\s*/g, "");

    const gmail = google.gmail({ version: "v1", auth: client });

    // Build RFC 2822 email message
    const messageParts = [
      "Content-Type: text/plain; charset=\"UTF-8\"",
      "MIME-Version: 1.0",
    ];
    if (to) messageParts.push("To: " + to);
    if (cleanSubject) messageParts.push("Subject: " + cleanSubject);
    messageParts.push("", cleanBody);

    const rawMessage = messageParts.join("\r\n");

    // Base64url encode
    const encoded = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const draft = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw: encoded,
        },
      },
    });

    return Response.json({
      success: true,
      draftId: draft.data.id,
      message: "Draft saved to Gmail",
    });
  } catch (error: any) {
    console.error("Draft save error:", error);

    // Handle token expiry
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
