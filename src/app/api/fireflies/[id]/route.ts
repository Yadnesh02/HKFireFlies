import { NextRequest } from "next/server";

export const runtime = "nodejs";

const FIREFLIES_GRAPHQL = "https://api.fireflies.ai/graphql";

const GET_TRANSCRIPT_QUERY = `
  query Transcript($id: String!) {
    transcript(id: $id) {
      id
      title
      date
      sentences {
        speaker_name
        text
      }
    }
  }
`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const apiKey = process.env.FIREFLIES_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "FIREFLIES_API_KEY not configured" },
        { status: 500 }
      );
    }

    const res = await fetch(FIREFLIES_GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: GET_TRANSCRIPT_QUERY,
        variables: { id },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Fireflies API error:", res.status, text);
      return Response.json(
        { error: "Fireflies API error (" + res.status + ")" },
        { status: 502 }
      );
    }

    const data = await res.json();

    if (data.errors) {
      console.error("Fireflies GraphQL errors:", data.errors);
      return Response.json(
        { error: data.errors[0]?.message || "GraphQL query failed" },
        { status: 502 }
      );
    }

    const transcript = data.data?.transcript;
    if (!transcript) {
      return Response.json({ error: "Transcript not found" }, { status: 404 });
    }

    // Build readable transcript text from sentences
    const sentences: { speaker_name: string; text: string }[] =
      transcript.sentences || [];

    let text = "";
    let currentSpeaker = "";
    for (const s of sentences) {
      if (s.speaker_name !== currentSpeaker) {
        currentSpeaker = s.speaker_name;
        text += "\n" + s.speaker_name + ":\n";
      }
      text += s.text + "\n";
    }
    text = text.trim();

    return Response.json({
      id: transcript.id,
      title: transcript.title || "Untitled Meeting",
      date: transcript.date
        ? new Date(Number(transcript.date)).toISOString()
        : null,
      text,
      charCount: text.length,
    });
  } catch (error: any) {
    console.error("Fireflies transcript error:", error);
    return Response.json(
      { error: error.message || "Failed to fetch transcript" },
      { status: 500 }
    );
  }
}
