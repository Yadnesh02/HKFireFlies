import { NextRequest } from "next/server";
import { SYSTEM_PROMPT, buildEmailPrompt } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 300;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-4";

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const body = await request.json();
    const { emailType, format, recipient, instructions, transcript } = body;

    if (!transcript) {
      return Response.json({ error: "No transcript provided" }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "OPENROUTER_API_KEY not configured in .env.local" },
        { status: 500 }
      );
    }

    const userPrompt = buildEmailPrompt({
      emailType,
      format,
      recipient,
      instructions,
      transcript,
    });

    // Call OpenRouter with streaming
    const apiResponse = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://fireflies-email.local",
        "X-Title": "FireFlies Email Generator",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text();
      console.error("OpenRouter error:", apiResponse.status, errBody);
      return Response.json(
        { error: "API error (" + apiResponse.status + "): " + errBody },
        { status: 502 }
      );
    }

    if (!apiResponse.body) {
      return Response.json({ error: "No response body from API" }, { status: 502 });
    }

    // Pipe the SSE stream from OpenRouter to the client
    const stream = new ReadableStream({
      async start(controller) {
        const reader = apiResponse.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(": ")) continue; // skip comments/keepalives

              if (trimmed === "data: [DONE]") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                continue;
              }

              if (trimmed.startsWith("data: ")) {
                try {
                  const json = JSON.parse(trimmed.slice(6));
                  const content = json.choices?.[0]?.delta?.content;
                  if (content) {
                    const chunk = "data: " + JSON.stringify({ text: content }) + "\n\n";
                    controller.enqueue(encoder.encode(chunk));
                  }
                } catch {}
              }
            }
          }

          // Process any remaining buffer
          if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
              try {
                const json = JSON.parse(trimmed.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  const chunk = "data: " + JSON.stringify({ text: content }) + "\n\n";
                  controller.enqueue(encoder.encode(chunk));
                }
              } catch {}
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err: any) {
          console.error("Stream error:", err.message);
          const errChunk = "data: " + JSON.stringify({ error: err.message }) + "\n\n";
          controller.enqueue(encoder.encode(errChunk));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("Generate route error:", error);
    return Response.json(
      { error: error.message || "Failed to generate email" },
      { status: 500 }
    );
  }
}
