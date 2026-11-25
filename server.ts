import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DIST_PATH = path.resolve(__dirname, "dist");
const IS_RUNNING_VIA_TSX = process.execArgv.some((arg) => arg.includes("tsx"));
const USE_STATIC_DIST =
  process.env.NODE_ENV === "production" ||
  (!IS_RUNNING_VIA_TSX && fs.existsSync(path.join(DIST_PATH, "index.html")));

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
  livePollutants?: {
    pm25?: number | null;
    pm10?: number | null;
    dominant?: string | null;
  } | null;
}

interface ChatTurn {
  role: "user" | "model";
  content: string;
}

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
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

// Official Indian CPCB National AQI breakpoints for linear sub-index calculation
type Breakpoint = [number, number, number, number]; // [C_lo, C_hi, I_lo, I_hi]

const CPCB_PM25: Breakpoint[] = [
  [0, 30, 0, 50],
  [30, 60, 51, 100],
  [60, 90, 101, 200],
  [90, 120, 201, 300],
  [120, 250, 301, 400],
  [250, 500, 401, 500],
];

const CPCB_PM10: Breakpoint[] = [
  [0, 50, 0, 50],
  [50, 100, 51, 100],
  [100, 250, 101, 200],
  [250, 350, 201, 300],
  [350, 430, 301, 400],
  [430, 750, 401, 500],
];

const CPCB_NO2: Breakpoint[] = [
  [0, 40, 0, 50],
  [40, 80, 51, 100],
  [80, 180, 101, 200],
  [180, 280, 201, 300],
  [280, 400, 301, 400],
  [400, 800, 401, 500],
];

const CPCB_O3: Breakpoint[] = [
  [0, 50, 0, 50],
  [50, 100, 51, 100],
  [100, 168, 101, 200],
  [168, 208, 201, 300],
  [208, 748, 301, 400],
  [748, 1200, 401, 500],
];

const CPCB_SO2: Breakpoint[] = [
  [0, 40, 0, 50],
  [40, 80, 51, 100],
  [80, 380, 101, 200],
  [380, 800, 201, 300],
  [800, 1600, 301, 400],
  [1600, 2400, 401, 500],
];

function computeSubIndex(value: number | null | undefined, table: Breakpoint[]): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  for (const [cLo, cHi, iLo, iHi] of table) {
    if (value <= cHi) {
      const ratio = (value - cLo) / Math.max(1e-6, cHi - cLo);
      return Math.round(iLo + ratio * (iHi - iLo));
    }
  }
  return 500;
}

function extractErrorMessage(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const statusProp =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : NaN;

  if (
    statusProp === 403 ||
    raw.includes("API_KEY_INVALID") ||
    raw.includes("403") ||
    raw.includes("PERMISSION_DENIED")
  ) {
    return {
      status: 403,
      message: "Gemini API key was rejected. Please verify your API key in Settings > Secrets.",
    };
  }
  if (statusProp === 404 || raw.includes("404") || raw.includes("NOT_FOUND")) {
    return {
      status: 404,
      message: `Model endpoint returned 404: ${raw.slice(0, 200)}`,
    };
  }
  if (statusProp === 429 || raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: "Too many requests right now. Please wait a moment and try again.",
    };
  }
  if (statusProp === 400 || raw.includes("400") || raw.includes("INVALID_ARGUMENT")) {
    return {
      status: 400,
      message: `Invalid request to AI service: ${raw.slice(0, 200)}`,
    };
  }
  return {
    status: 500,
    message: `Unable to generate the personalised plan right now (${raw.slice(0, 160)}).`,
  };
}

function initSSE(res: express.Response) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function sendSSE(res: express.Response, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function openGeminiStreamWithRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const { status } = extractErrorMessage(err);
      // Do not retry client/auth/not-found errors
      if (status === 400 || status === 403 || status === 404) {
        throw err;
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, mode: USE_STATIC_DIST ? "static" : "vite-dev" });
  });

  // GET /api/aqi?lat=...&lng=... OR /api/aqi?city=...
  app.get("/api/aqi", async (req, res) => {
    try {
      let lat = req.query.lat !== undefined ? Number(req.query.lat) : NaN;
      let lng = req.query.lng !== undefined ? Number(req.query.lng) : NaN;
      const cityQuery = typeof req.query.city === "string" ? req.query.city.trim().slice(0, 120) : "";

      let resolvedName = cityQuery;
      let resolvedRegion = "";

      // If city name is provided without coordinates, geocode it via Open-Meteo Geocoding API (free, no key)
      if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && cityQuery) {
        // Try full query first, then primary city segment before comma if user wrote "Lucknow, Gomti Nagar"
        const attempts = [cityQuery];
        if (cityQuery.includes(",")) {
          const primary = cityQuery.split(",")[0].trim();
          if (primary) attempts.push(primary);
        }

        let geoHit: {
          latitude: number;
          longitude: number;
          name: string;
          admin1?: string;
          country?: string;
        } | null = null;

        for (const term of attempts) {
          const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=1&language=en&format=json`;
          const geoResp = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
          if (geoResp.ok) {
            const geoData = (await geoResp.json()) as {
              results?: Array<{
                latitude: number;
                longitude: number;
                name: string;
                admin1?: string;
                country?: string;
              }>;
            };
            if (geoData.results && geoData.results.length > 0) {
              geoHit = geoData.results[0];
              break;
            }
          }
        }

        if (!geoHit) {
          res.status(404).json({
            error: `Couldn’t find "${cityQuery}". Try a nearby major city name or use your device location.`,
          });
          return;
        }

        lat = geoHit.latitude;
        lng = geoHit.longitude;
        resolvedName = geoHit.name;
        resolvedRegion = [geoHit.admin1, geoHit.country].filter(Boolean).join(", ");
      }

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        res.status(400).json({
          error: "Provide valid latitude/longitude coordinates or a city name.",
        });
        return;
      }

      // Fetch live air quality + current weather (temperature & humidity) from Open-Meteo in parallel
      const aqUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
      aqUrl.searchParams.set("latitude", lat.toFixed(4));
      aqUrl.searchParams.set("longitude", lng.toFixed(4));
      aqUrl.searchParams.set(
        "current",
        "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi,european_aqi"
      );
      aqUrl.searchParams.set("hourly", "pm2_5,pm10");
      aqUrl.searchParams.set("forecast_days", "1");
      aqUrl.searchParams.set("timezone", "auto");

      const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
      weatherUrl.searchParams.set("latitude", lat.toFixed(4));
      weatherUrl.searchParams.set("longitude", lng.toFixed(4));
      weatherUrl.searchParams.set("current", "temperature_2m,relative_humidity_2m,wind_speed_10m");
      weatherUrl.searchParams.set("timezone", "auto");

      const [aqResult, weatherResult] = await Promise.allSettled([
        fetch(aqUrl.toString(), { signal: AbortSignal.timeout(9000) }),
        fetch(weatherUrl.toString(), { signal: AbortSignal.timeout(6000) }),
      ]);

      if (aqResult.status !== "fulfilled" || !aqResult.value.ok) {
        res.status(502).json({
          error: "Live air quality service is temporarily unavailable. You can still set the AQI slider manually.",
        });
        return;
      }

      const aqData = (await aqResult.value.json()) as {
        timezone?: string;
        current?: {
          time?: string;
          pm2_5?: number | null;
          pm10?: number | null;
          nitrogen_dioxide?: number | null;
          ozone?: number | null;
          sulphur_dioxide?: number | null;
          carbon_monoxide?: number | null;
          us_aqi?: number | null;
          european_aqi?: number | null;
        };
        hourly?: {
          time?: string[];
          pm2_5?: Array<number | null>;
        };
      };

      let weather: {
        temperatureC: number | null;
        humidityPct: number | null;
        windSpeedKmh: number | null;
      } | null = null;

      if (weatherResult.status === "fulfilled" && weatherResult.value.ok) {
        try {
          const wData = (await weatherResult.value.json()) as {
            current?: {
              temperature_2m?: number | null;
              relative_humidity_2m?: number | null;
              wind_speed_10m?: number | null;
            };
          };
          if (wData.current) {
            weather = {
              temperatureC:
                typeof wData.current.temperature_2m === "number"
                  ? Number(wData.current.temperature_2m.toFixed(1))
                  : null,
              humidityPct:
                typeof wData.current.relative_humidity_2m === "number"
                  ? Math.round(wData.current.relative_humidity_2m)
                  : null,
              windSpeedKmh:
                typeof wData.current.wind_speed_10m === "number"
                  ? Number(wData.current.wind_speed_10m.toFixed(1))
                  : null,
            };
          }
        } catch {
          // Non-fatal: weather is optional
        }
      }

      // Best-effort reverse geocode when coordinates were supplied directly without city name
      if (!resolvedName) {
        try {
          const revUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&localityLanguage=en`;
          const revResp = await fetch(revUrl, { signal: AbortSignal.timeout(4000) });
          if (revResp.ok) {
            const revData = (await revResp.json()) as {
              locality?: string;
              city?: string;
              principalSubdivision?: string;
              countryName?: string;
            };
            const primary = revData.city || revData.locality || "";
            const sub = revData.locality && revData.city && revData.locality !== revData.city ? revData.locality : "";
            resolvedName = [primary, sub].filter(Boolean).join(", ");
            resolvedRegion = [revData.principalSubdivision, revData.countryName].filter(Boolean).join(", ");
          }
        } catch {
          // Non-fatal: coordinates still work fine without reverse geocoded label
        }
      }

      const cur = aqData.current ?? {};
      const subIndices: Array<{ name: string; value: number }> = [];
      const pm25Idx = computeSubIndex(cur.pm2_5, CPCB_PM25);
      if (pm25Idx !== null) subIndices.push({ name: "PM2.5", value: pm25Idx });
      const pm10Idx = computeSubIndex(cur.pm10, CPCB_PM10);
      if (pm10Idx !== null) subIndices.push({ name: "PM10", value: pm10Idx });
      const no2Idx = computeSubIndex(cur.nitrogen_dioxide, CPCB_NO2);
      if (no2Idx !== null) subIndices.push({ name: "NO₂", value: no2Idx });
      const o3Idx = computeSubIndex(cur.ozone, CPCB_O3);
      if (o3Idx !== null) subIndices.push({ name: "O₃", value: o3Idx });
      const so2Idx = computeSubIndex(cur.sulphur_dioxide, CPCB_SO2);
      if (so2Idx !== null) subIndices.push({ name: "SO₂", value: so2Idx });

      subIndices.sort((a, b) => b.value - a.value);
      const cpcbAqi =
        subIndices.length > 0
          ? Math.max(0, Math.min(500, subIndices[0].value))
          : typeof cur.us_aqi === "number"
            ? Math.max(0, Math.min(500, Math.round(cur.us_aqi)))
            : 150;
      const dominant = subIndices.length > 0 ? subIndices[0].name : "PM2.5";

      // Extract today's hourly PM2.5 profile for the mini diurnal trend bar
      const hourlyTimes = aqData.hourly?.time ?? [];
      const hourlyPm25 = aqData.hourly?.pm2_5 ?? [];
      const hourlyTrend = hourlyTimes.slice(0, 24).map((t, idx) => ({
        hour: t.slice(11, 16),
        pm25: typeof hourlyPm25[idx] === "number" ? Math.round(hourlyPm25[idx]!) : null,
      }));

      res.json({
        location: {
          name: resolvedName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
          region: resolvedRegion,
          lat,
          lng,
        },
        aqi: cpcbAqi,
        usAqi: typeof cur.us_aqi === "number" ? Math.round(cur.us_aqi) : null,
        dominantPollutant: dominant,
        observedAt: cur.time ?? new Date().toISOString(),
        timezone: aqData.timezone ?? "local",
        pollutants: {
          pm25: typeof cur.pm2_5 === "number" ? Number(cur.pm2_5.toFixed(1)) : null,
          pm10: typeof cur.pm10 === "number" ? Number(cur.pm10.toFixed(1)) : null,
          no2: typeof cur.nitrogen_dioxide === "number" ? Number(cur.nitrogen_dioxide.toFixed(1)) : null,
          o3: typeof cur.ozone === "number" ? Number(cur.ozone.toFixed(1)) : null,
          so2: typeof cur.sulphur_dioxide === "number" ? Number(cur.sulphur_dioxide.toFixed(1)) : null,
        },
        weather,
        hourlyTrend,
      });
    } catch (err) {
      console.error("AQI fetch failed:", err);
      res.status(502).json({
        error: "Couldn’t load live readings right now. You can still set the AQI slider manually.",
      });
    }
  });

  // POST /api/plan — streams personalised plan via Server-Sent Events
  app.post("/api/plan", async (req, res) => {
    const ai = getGenAIClient();
    if (!ai) {
      res.status(503).json({
        error: "AI service is not configured. Check your Gemini API key in Settings > Secrets.",
      });
      return;
    }

    const body = req.body as HouseholdProfileInput | undefined;
    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Household profile is required." });
      return;
    }

    const profileText = buildProfilePrompt(body);

    try {
      const stream = await openGeminiStreamWithRetry(() =>
        ai.models.generateContentStream({
          model: "gemini-4-hydrogen",
          contents: `Household profile:\n${profileText}`,
          config: {
            systemInstruction: PLAN_SYSTEM_INSTRUCTION,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        })
      );

      initSSE(res);

      let fullText = "";
      for await (const chunk of stream) {
        const delta = chunk.text ?? "";
        if (delta) {
          fullText += delta;
          sendSSE(res, { type: "delta", text: delta });
        }
      }

      sendSSE(res, { type: "done", fullText });
      res.end();
    } catch (err) {
      console.error("Plan generation error:", err);
      const { status, message } = extractErrorMessage(err);
      if (res.headersSent) {
        sendSSE(res, { type: "error", error: message });
        res.end();
      } else {
        res.status(status).json({ error: message });
      }
    }
  });

  // POST /api/followup — streams grounded follow-up reply via Server-Sent Events
  app.post("/api/followup", async (req, res) => {
    const ai = getGenAIClient();
    if (!ai) {
      res.status(503).json({
        error: "AI service is not configured. Check your Gemini API key in Settings > Secrets.",
      });
      return;
    }

    const body = req.body as {
      profile?: HouseholdProfileInput;
      plan?: string;
      history?: ChatTurn[];
      question?: string;
    };

    const question = sanitizeText(body?.question, 500);
    if (!body?.profile || !question) {
      res.status(400).json({ error: "A household profile and follow-up question are required." });
      return;
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

    try {
      const stream = await openGeminiStreamWithRetry(() =>
        ai.models.generateContentStream({
          model: "gemini-4-hydrogen",
          contents,
          config: {
            systemInstruction: FOLLOWUP_SYSTEM_INSTRUCTION,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        })
      );

      initSSE(res);

      let fullText = "";
      for await (const chunk of stream) {
        const delta = chunk.text ?? "";
        if (delta) {
          fullText += delta;
          sendSSE(res, { type: "delta", text: delta });
        }
      }

      sendSSE(res, { type: "done", fullText });
      res.end();
    } catch (err) {
      console.error("Follow-up error:", err);
      const { status, message } = extractErrorMessage(err);
      if (res.headersSent) {
        sendSSE(res, { type: "error", error: message });
        res.end();
      } else {
        res.status(status).json({ error: message });
      }
    }
  });

  // Explicit JSON 404 for unknown API routes so they never fall through to SPA HTML
  app.all("/api/*", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found." });
  });

  if (USE_STATIC_DIST) {
    app.use(express.static(DIST_PATH));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(DIST_PATH, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);

    // SPA fallback if needed
    app.use("*", async (req, res, next) => {
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(__dirname, "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Urban Air Quality Assistant listening on http://localhost:${PORT}`);
  });
}

startServer();
