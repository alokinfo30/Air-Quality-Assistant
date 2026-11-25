import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const FOLLOWUP_SYSTEM_INSTRUCTION = `You are an urban air quality assistant helping a household with follow-up questions about their personalised air quality plan.
- Stay grounded in the household profile and the plan already provided.
- Answer concisely (under 180 words) using short paragraphs or "- " bullets.
- Use qualitative, evidence-aligned guidance without inventing statistics.
- Never diagnose medical conditions; advise contacting a doctor for breathing trouble, chest pain, or worsening symptoms.`;

interface HouseholdProfileInput {
  city?: string;
  coords?: { lat: number; lng: number } | null;
  aqi: number;
  category: string;
  who: string[];
  commute: string;
  cook: string;
  purifier: string;
  budget: string;
}

interface ChatTurn {
  role: "user" | "model";
  content: string;
}

function sanitizeText(value: unknown, maxLength = 240): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

function buildProfilePrompt(input: HouseholdProfileInput): string {
  const city = sanitizeText(input.city, 120);
  const aqi = Math.max(0, Math.min(500, Math.round(Number(input.aqi) || 0)));
  const category = sanitizeText(input.category, 40) || "Unknown";
  const whoList = Array.isArray(input.who)
    ? input.who.map((item) => sanitizeText(item, 60)).filter(Boolean).slice(0, 10)
    : [];

  return [
    `City/area: ${city || "not specified"}`,
    `Current AQI (CPCB scale 0-500): ${aqi} (${category})`,
    `Household: ${whoList.length > 0 ? whoList.join(", ") : "healthy adults"}`,
    `Main commute: ${sanitizeText(input.commute, 80) || "Not specified"}`,
    `Cooking/heating: ${sanitizeText(input.cook, 80) || "Not specified"}`,
    `Indoor air equipment: ${sanitizeText(input.purifier, 80) || "None"}`,
    `Budget: ${sanitizeText(input.budget, 60) || "Moderate"}`,
  ].join("\n");
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return jsonResponse(
      {
        error:
          "GEMINI_API_KEY is not configured on this server. Add GEMINI_API_KEY in Netlify Site configuration > Environment variables and redeploy.",
      },
      503
    );
  }

  let body: {
    profile?: HouseholdProfileInput;
    plan?: string;
    history?: ChatTurn[];
    question?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload." }, 400);
  }

  const question = sanitizeText(body?.question, 500);
  if (!body?.profile || !question) {
    return jsonResponse({ error: "A household profile and follow-up question are required." }, 400);
  }

  const profileText = buildProfilePrompt(body.profile);
  const planText = typeof body.plan === "string" ? body.plan.slice(0, 6000) : "";
  const priorHistory = Array.isArray(body.history)
    ? body.history
        .filter(
          (m): m is ChatTurn =>
            m &&
            (m.role === "user" || m.role === "model") &&
            typeof m.content === "string" &&
            m.content.trim().length > 0
        )
        .slice(-8)
    : [];

  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [
    {
      role: "user",
      parts: [{ text: `Household profile:\n${profileText}\n\nPlease provide my personalised air quality plan.` }],
    },
    {
      role: "model",
      parts: [{ text: planText || "I have reviewed your household profile." }],
    },
    ...priorHistory.map((m) => ({
      role: m.role,
      parts: [{ text: m.content.slice(0, 2000) }],
    })),
    {
      role: "user",
      parts: [{ text: question }],
    },
  ];

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  try {
    const stream = await ai.models.generateContentStream({
      model: "gemini-4-hydrogen",
      contents,
      config: {
        systemInstruction: FOLLOWUP_SYSTEM_INSTRUCTION,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        let fullText = "";
        try {
          for await (const chunk of stream) {
            const delta = chunk.text ?? "";
            if (delta) {
              fullText += delta;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`)
              );
            }
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done", fullText })}\n\n`)
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Stream interrupted.";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const status = raw.includes("429") ? 429 : raw.includes("403") ? 403 : 500;
    return jsonResponse(
      {
        error:
          status === 429
            ? "Too many requests right now. Please wait a moment and try again."
            : "Couldn’t answer right now. Please try again shortly.",
      },
      status
    );
  }
}
