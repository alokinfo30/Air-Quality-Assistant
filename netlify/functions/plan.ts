import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const PLAN_SYSTEM_INSTRUCTION = `You are an urban air quality assistant for families in cities facing severe winter smog and urban air pollution. Using the household profile, give practical, specific, compassionate advice.

Use EXACTLY these six markdown sections with "## " headings:
## Today’s risk
## Daily routine (morning, midday, evening)
## Indoor air hacks
## Greener swaps for your commute and cooking
## Why it matters
## Warning signs

Formatting and content rules:
- Use short, concrete bullet points starting with "- ".
- Keep the entire plan under 450 words so a busy household can read it in two minutes.
- Put low-cost or free indoor air hacks first, matching the stated budget.
- In "Why it matters", explain the direct, plain-language impact of each recommended choice on air quality and health using qualitative claims and no invented statistics.
- Do not diagnose medical conditions.
- Be honest that purifiers, masks, and routines reduce exposure but do not eliminate it.
- Tailor every tip specifically to the stated city/region, AQI level, cooking/heating fuel, commute mode, indoor equipment, and vulnerable household members.`;

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
  livePollutants?: {
    pm25?: number | null;
    pm10?: number | null;
    dominant?: string | null;
  } | null;
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
  const commute = sanitizeText(input.commute, 80) || "Not specified";
  const cook = sanitizeText(input.cook, 80) || "Not specified";
  const purifier = sanitizeText(input.purifier, 80) || "None";
  const budget = sanitizeText(input.budget, 60) || "Moderate";

  const hasCoords =
    input.coords &&
    Number.isFinite(input.coords.lat) &&
    Number.isFinite(input.coords.lng) &&
    Math.abs(input.coords.lat) <= 90 &&
    Math.abs(input.coords.lng) <= 180;

  const coordNote = hasCoords
    ? ` (approx. coordinates ${input.coords!.lat.toFixed(2)}, ${input.coords!.lng.toFixed(2)}; tailor advice to this region and its typical smog sources)`
    : "";

  const locationLine = city
    ? `${city}${coordNote}`
    : hasCoords
      ? `Coordinates ${input.coords!.lat.toFixed(2)}, ${input.coords!.lng.toFixed(2)}`
      : "not given (use general urban North India winter smog guidance)";

  const pollutantDetails: string[] = [];
  if (input.livePollutants) {
    if (typeof input.livePollutants.pm25 === "number") {
      pollutantDetails.push(`PM2.5: ${input.livePollutants.pm25.toFixed(1)} µg/m³`);
    }
    if (typeof input.livePollutants.pm10 === "number") {
      pollutantDetails.push(`PM10: ${input.livePollutants.pm10.toFixed(1)} µg/m³`);
    }
    if (input.livePollutants.dominant) {
      pollutantDetails.push(`Dominant pollutant: ${sanitizeText(input.livePollutants.dominant, 20)}`);
    }
  }

  return [
    `City/area: ${locationLine}`,
    `Current AQI (CPCB scale 0-500): ${aqi} (${category})`,
    pollutantDetails.length > 0 ? `Live readings: ${pollutantDetails.join(", ")}` : null,
    `Household: ${whoList.length > 0 ? whoList.join(", ") : "healthy adults"}`,
    `Main commute: ${commute}`,
    `Cooking/heating: ${cook}`,
    `Indoor air equipment: ${purifier}`,
    `Budget: ${budget}`,
  ]
    .filter(Boolean)
    .join("\n");
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

  let body: HouseholdProfileInput;
  try {
    body = (await req.json()) as HouseholdProfileInput;
  } catch {
    return jsonResponse({ error: "Invalid JSON payload." }, 400);
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  const profileText = buildProfilePrompt(body);

  try {
    const stream = await ai.models.generateContentStream({
      model: "gemini-4-hydrogen",
      contents: `Household profile:\n${profileText}`,
      config: {
        systemInstruction: PLAN_SYSTEM_INSTRUCTION,
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
            : status === 403
              ? "Gemini API key was rejected. Check GEMINI_API_KEY in your environment variables."
              : "Unable to generate your personalised plan right now. Please try again shortly.",
      },
      status
    );
  }
}
