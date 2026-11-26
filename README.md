# Urban Air Quality Assistant

A full-stack web application that helps households in cities affected by urban smog and winter air pollution track live local air quality, follow immediate protective measures, log personal health symptoms over time, and generate tailored low-emission daily plans.

---

## Key Features

### 1. Live Air Quality & Local Weather
- **City Search & Browser Geolocation:** Fetch real-time readings by entering a city/neighbourhood or clicking **Use my location**.
- **CPCB National AQI (0–500):** Calculates the Indian CPCB AQI across six standard bands (*Good*, *Satisfactory*, *Moderate*, *Poor*, *Very poor*, *Severe*) from live `PM2.5`, `PM10`, `NO₂`, `O₃`, and `SO₂` measurements, alongside US AQI and dominant pollutant readout.
- **24-Hour PM2.5 Profile:** Displays today’s hourly PM2.5 trend bar strip to spot morning/evening peaks and midday ventilation windows.
- **Current Temperature, Humidity & Wind:** Fetches live meteorological conditions alongside AQI and surfaces dispersion context in the **Right now** panel.
- **Station Verification Links:** Direct links to nearby monitoring stations on WAQI Map and CPCB India.

### 2. Interactive AQI Slider & Immediate Actions
- **Real-Time AQI Control:** Adjust the 0–500 AQI slider manually at any time to preview guidance across every CPCB band.
- **Right Now at This AQI:** Dynamically updates actionable steps (ventilation timing, N95/FFP2 masking, indoor exercise, clean-room sealing, and burning avoidance) as AQI changes.

### 3. Household Profile & Personalised AI Plan
- **Tailored Context:** Captures city/coordinates, commute mode, cooking/heating fuel, indoor air equipment, budget tier, and vulnerable household members (young children, older adults, asthma/lung conditions, heart conditions, pregnancy, outdoor workers).
- **Streaming Personalised Plan:** Calls the server-side Gemini backend (`gemini-4-hydrogen`) via Server-Sent Events (SSE) to generate a concise, structured plan covering:
  - *Today’s risk*
  - *Daily routine (morning, midday, evening)*
  - *Indoor air hacks* (budget-aware, low-cost first)
  - *Greener swaps for your commute and cooking*
  - *Why it matters*
  - *Warning signs*
- **Multi-Turn Follow-up Q&A:** Ask follow-up questions grounded in the household profile and current plan, with one-click starter prompts, copy-to-clipboard, and print formatting.

### 4. Personal Symptom Log Tracker
- **Check-In Logging:** Record how you feel (*Feeling fine*, *Mild*, *Moderate*, *Significant*), tag specific symptoms (*Dry cough*, *Throat irritation*, *Eye irritation*, *Shortness of breath*, *Wheezing*, *Nasal congestion*, *Headache*, *Fatigue*), and add context notes automatically paired with the current AQI, temperature, and humidity.
- **Health Trend Visualization:** Interactive SVG chart plotting recorded AQI bars against personal symptom severity over time, plus summary metrics (check-in count, average AQI, lowest symptomatic AQI threshold, and most frequent symptom).
- **Local Privacy & Export:** Stored locally in browser `localStorage` (`uaq-symptom-log-v1`) with one-click **Export CSV** and **Clear log** controls.

### 5. Why Your Choices Matter & Accessibility
- **Impact Reference Grid:** Plain-language explanations of how commute swaps, avoiding open burning, cleaner cooking fuels, timed ventilation, and well-fitted N95/FFP2 masks reduce exposure and local emissions.
- **Light & Dark Mode:** Persistent appearance toggle synced with system preferences, accessible focus states, tabular numerals, and `prefers-reduced-motion` support.

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide icons
- **Backend (Node.js):** Express 4 (`server.ts`) with Vite dev middleware and automatic static `dist/` serving in production
- **Serverless Backend (Netlify):** Netlify Functions v2 (`netlify/functions/`) with Web Standard SSE streaming
- **AI Integration:** `@google/genai` SDK (`gemini-4-hydrogen`, server-side only)
- **Live Air Quality & Weather APIs (Free, Keyless):**
  - Open-Meteo Air Quality API (`air-quality-api.open-meteo.com`)
  - Open-Meteo Weather Forecast API (`api.open-meteo.com`)
  - Open-Meteo Geocoding API (`geocoding-api.open-meteo.com`)
  - BigDataCloud Reverse Geocode API (`api.bigdatacloud.net`)

---

## Project Structure

```text
.
├── index.html                        # HTML entry point, metadata, and Google Fonts
├── metadata.json                     # App metadata and capabilities
├── netlify.toml                      # Netlify build, functions, and /api/* redirect config
├── package.json                      # Dependencies and npm scripts
├── server.ts                         # Full-stack Express + Vite server (local & Node hosting)
├── vite.config.ts                    # Vite + React + Tailwind configuration
├── .env.example                      # Environment variable template
├── netlify/
│   └── functions/
│       ├── aqi.ts                    # Serverless GET /api/aqi handler
│       ├── plan.ts                   # Serverless POST /api/plan SSE handler
│       └── followup.ts               # Serverless POST /api/followup SSE handler
└── src/
    ├── main.tsx                      # React root mount
    ├── index.css                     # Tailwind v4 theme, dark variant, and custom AQI slider
    ├── App.tsx                       # Main application workspace and state orchestration
    ├── lib/
    │   ├── aqi.ts                    # CPCB AQI bands, quick actions, symptom & form constants
    │   └── liveAqiClient.ts          # Direct Open-Meteo client & CPCB sub-index calculator
    └── components/
        ├── MarkdownRenderer.tsx      # Safe React markdown renderer (no raw HTML injection)
        └── SymptomLog.tsx            # Symptom check-in form, SVG trend chart, and CSV export
```

---

## Environment Variables

Copy `.env.example` to `.env` for local development:

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes (for AI plans) | Server-side Gemini API key used by `server.ts` and `netlify/functions/{plan,followup}.ts`. Never exposed to the browser. |
| `PORT` | No | Server port for `server.ts` (defaults to `3000`). |
| `APP_URL` | No | Public deployment URL if needed for links or callbacks. |

> Live AQI, temperature, humidity, quick actions, and the symptom log work without any API keys.

---

## Getting Started Locally

### Prerequisites
- Node.js 22+
- npm

### Installation & Development

```bash
# Install dependencies
npm install

# Run full-stack development server (Express + Vite on http://localhost:3000)
npm run dev
```

### Available Scripts

| Script | Command | Description |
| --- | --- | --- |
| `npm run dev` | `tsx server.ts` | Starts the Express + Vite development server on port `3000`. |
| `npm run build` | `vite build` | Builds the production frontend bundle into `dist/`. |
| `npm start` | `node server.ts` | Runs the production Node.js server serving `dist/` and `/api/*`. |
| `npm run preview` | `node server.ts` | Serves the built app with full `/api/*` support. |
| `npm run lint` | `tsc --noEmit` | Runs TypeScript type-checking across the workspace. |

---

## Backend API Endpoints

All AI routes run exclusively server-side and stream Server-Sent Events (`text/event-stream`):

- `GET /api/health` — Returns `{ ok: true, mode }` health status (`server.ts`).
- `GET /api/aqi?lat=<lat>&lng=<lng>` or `GET /api/aqi?city=<name>` — Resolves coordinates, fetches Open-Meteo air quality + weather, and returns CPCB AQI, pollutants, weather, and 24h PM2.5 trend. *(The browser also calls Open-Meteo directly via `src/lib/liveAqiClient.ts` so static deployments work without a backend.)*
- `POST /api/plan` — Accepts the household profile JSON and streams the six-section personalised daily plan (`delta`, `done`, or `error` SSE events).
- `POST /api/followup` — Accepts `{ profile, plan, history, question }` and streams a grounded follow-up answer.

---

## Deployment

### Deploying to Netlify
This repository includes `netlify.toml` and `netlify/functions/` pre-configured for Netlify:

1. Connect the repository to Netlify (deploy the full project rather than uploading `dist/` alone so Netlify bundles `netlify/functions/`).
2. Confirm build settings (auto-detected from `netlify.toml`):
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Functions directory:** `netlify/functions`
3. Add `GEMINI_API_KEY` under **Site configuration → Environment variables** and trigger a deploy.

### Deploying to Node.js / Cloud Run
```bash
npm install
npm run build
NODE_ENV=production npm start
```
Set `GEMINI_API_KEY` (and optionally `PORT`) in your hosting environment.

---

## Disclaimer & Privacy

- **Not Medical Advice:** All AQI guidance, personalised plans, and follow-up responses are general informational guidance only. Anyone experiencing trouble breathing, chest pain, dizziness, or worsening symptoms should consult a doctor.
- **Local Storage:** Symptom log entries and theme preferences are stored strictly in your browser’s `localStorage` and are not persisted on a remote database.
