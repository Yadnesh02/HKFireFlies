import { NextRequest } from "next/server";

export const runtime = "nodejs";

const FIREFLIES_GRAPHQL = "https://api.fireflies.ai/graphql";

const LIST_TRANSCRIPTS_QUERY = `
  query {
    transcripts {
      id
      title
      date
      duration
      organizer_email
      participants
      transcript_url
    }
  }
`;

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.FIREFLIES_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "FIREFLIES_API_KEY not configured in .env.local" },
        { status: 500 }
      );
    }

    const res = await fetch(FIREFLIES_GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: LIST_TRANSCRIPTS_QUERY }),
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

    const transcripts = (data.data?.transcripts || []).map((t: any) => ({
      id: t.id,
      title: t.title || "Untitled Meeting",
      date: t.date ? new Date(Number(t.date)).toISOString() : null,
      duration: t.duration || 0,
      organizer_email: t.organizer_email || "",
      participants: t.participants || [],
      transcript_url: t.transcript_url || "",
    }));

    return Response.json({ transcripts });
  } catch (error: any) {
    console.error("Fireflies list error:", error);
    return Response.json(
      { error: error.message || "Failed to fetch recordings" },
      { status: 500 }
    );
  }
}
