import { NextRequest } from "next/server";
import { google } from "googleapis";
import { getAuthenticatedClient } from "@/lib/google-auth";

export async function POST(request: NextRequest) {
  try {
    const client = getAuthenticatedClient();
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

    const gmail = google.gmail({ version: "v1", auth: client });

    // Build RFC 2822 email message
    const messageParts = [
      "Content-Type: text/plain; charset=\"UTF-8\"",
      "MIME-Version: 1.0",
    ];
    if (to) messageParts.push("To: " + to);
    if (subject) messageParts.push("Subject: " + subject);
    messageParts.push("", body);

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
