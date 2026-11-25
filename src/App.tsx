import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  Moon,
  Printer,
  RefreshCw,
  Search,
  Send,
  Sun,
} from "lucide-react";
import {
  AQI_CATEGORIES,
  BUDGET_OPTIONS,
  COMMUTE_OPTIONS,
  COOKING_OPTIONS,
  FOLLOWUP_SUGGESTIONS,
  HOUSEHOLD_MEMBERS,
  IMPACT_CARDS,
  PURIFIER_OPTIONS,
  QUICK_ACTIONS,
  getAqiCategory,
  type LiveAqiReading,
} from "./lib/aqi";
import { MarkdownRenderer } from "./components/MarkdownRenderer";
import { SymptomLog } from "./components/SymptomLog";
import { fetchOpenMeteoAqi } from "./lib/liveAqiClient";

const STATIC_HOST_PLAN_NOTE =
  "AI plan generation isn’t active on this static host yet. To enable it on Netlify, deploy the repository (which includes netlify.toml and netlify/functions/) and add GEMINI_API_KEY in Site configuration > Environment variables. Live AQI, quick actions, and the symptom log continue working without it.";

async function readApiError(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 404 || contentType.includes("text/html")) {
    return STATIC_HOST_PLAN_NOTE;
  }
  if (contentType.includes("application/json")) {
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) return data.error;
    } catch {
      // Fall through to fallback
    }
  }
  return fallback;
}

interface ChatTurn {
  role: "user" | "model";
  content: string;
}

async function consumeSSEStream(
  response: Response,
  onDelta: (delta: string) => void
): Promise<string> {
  if (!response.body) {
    throw new Error("Streaming response body is unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      const dataLine = rawEvent
        .split("\n")
        .find((line) => line.startsWith("data:"));
      if (!dataLine) continue;

      const jsonStr = dataLine.slice(5).trim();
      if (!jsonStr) continue;

      const parsed = JSON.parse(jsonStr) as {
        type?: string;
        text?: string;
        fullText?: string;
        error?: string;
      };

      if (parsed.type === "error") {
        throw new Error(parsed.error || "Failed to generate response.");
      }
      if (parsed.type === "delta" && parsed.text) {
        accumulated += parsed.text;
        onDelta(accumulated);
      }
      if (parsed.type === "done" && typeof parsed.fullText === "string") {
        accumulated = parsed.fullText;
        onDelta(accumulated);
      }
    }
  }

  return accumulated;
}

export default function App() {
  // Theme state synced with <html class="dark">
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem("uaq-theme");
    if (saved === "dark") return true;
    if (saved === "light") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", darkMode);
    try {
      window.localStorage.setItem("uaq-theme", darkMode ? "dark" : "light");
    } catch {
      // Ignore storage failures in restricted contexts
    }
  }, [darkMode]);

  // Household profile state
  const [city, setCity] = useState("");
  const [commute, setCommute] = useState(COMMUTE_OPTIONS[0]);
  const [cook, setCook] = useState(COOKING_OPTIONS[0]);
  const [purifier, setPurifier] = useState(PURIFIER_OPTIONS[0]);
  const [budget, setBudget] = useState(BUDGET_OPTIONS[1]);
  const [aqi, setAqi] = useState<number>(320);
  const [selectedWho, setSelectedWho] = useState<string[]>([]);

  // Location & Live AQI state
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [liveReading, setLiveReading] = useState<LiveAqiReading | null>(null);
  const [aqiLoading, setAqiLoading] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string>("");
  const [locationError, setLocationError] = useState<string>("");

  // Personalised AI Plan state
  const [planText, setPlanText] = useState("");
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const [planSnapshotAqi, setPlanSnapshotAqi] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Follow-up conversation state
  const [followUps, setFollowUps] = useState<ChatTurn[]>([]);
  const [questionInput, setQuestionInput] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState("");

  const planSectionRef = useRef<HTMLElement | null>(null);

  const category = useMemo(() => getAqiCategory(aqi), [aqi]);
  const quickActions = useMemo(
    () => QUICK_ACTIONS[category.label] ?? QUICK_ACTIONS["Very poor"],
    [category.label]
  );

  const toggleHouseholdMember = (value: string) => {
    setSelectedWho((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  };

  const fetchLiveAqi = async (params: { lat?: number; lng?: number; city?: string }) => {
    setAqiLoading(true);
    setLocationError("");

    try {
      if (
        (typeof params.lat !== "number" || typeof params.lng !== "number") &&
        !params.city?.trim()
      ) {
        setLocationError("Enter a city name or use your device location first.");
        setAqiLoading(false);
        return;
      }

      const reading = await fetchOpenMeteoAqi(params);
      setLiveReading(reading);
      setAqi(reading.aqi);
      setCoords({ lat: reading.location.lat, lng: reading.location.lng });

      if (!params.city && reading.location.name) {
        setCity(reading.location.name);
      }

      const placeLabel = reading.location.region
        ? `${reading.location.name}, ${reading.location.region}`
        : reading.location.name;
      setLocationMessage(`Live reading loaded for ${placeLabel}`);
    } catch (err) {
      setLocationError(
        err instanceof Error
          ? err.message
          : "Couldn’t fetch live air quality right now. Set the AQI slider manually."
      );
    } finally {
      setAqiLoading(false);
    }
  };

  const handleUseLocation = () => {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("Location isn’t supported in this browser. Type your city and fetch AQI instead.");
      return;
    }

    setLocLoading(true);
    setLocationMessage("Finding your coordinates…");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const nextCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setCoords(nextCoords);
        setLocLoading(false);
        setLocationMessage(
          `Detected ${nextCoords.lat.toFixed(2)}, ${nextCoords.lng.toFixed(2)} — loading live AQI…`
        );
        await fetchLiveAqi(nextCoords);
      },
      (err) => {
        setLocLoading(false);
        setLocationMessage("");
        setLocationError(
          err.code === 1
            ? "Location permission was declined. Type your city to fetch live AQI instead."
            : "Couldn’t determine your location. Type your city to fetch live AQI instead."
        );
      },
      { timeout: 10000, maximumAge: 600000 }
    );
  };

  const buildProfilePayload = () => ({
    city: city.trim(),
    coords,
    aqi,
    category: category.label,
    who: selectedWho,
    commute,
    cook,
    purifier,
    budget,
    livePollutants: liveReading
      ? {
          pm25: liveReading.pollutants.pm25,
          pm10: liveReading.pollutants.pm10,
          dominant: liveReading.dominantPollutant,
        }
      : null,
  });

  const handleBuildPlan = async () => {
    setPlanLoading(true);
    setPlanError("");
    setPlanText("");
    setFollowUps([]);
    setFollowUpError("");
    setPlanSnapshotAqi(aqi);

    planSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const response = await fetch("./api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildProfilePayload()),
      });

      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || contentType.includes("text/html")) {
        throw new Error(
          await readApiError(response, "Unable to generate your personalised plan right now.")
        );
      }

      await consumeSSEStream(response, (text) => {
        setPlanText(text);
      });
    } catch (err) {
      setPlanError(
        err instanceof Error
          ? err.message
          : "Couldn’t generate a plan just now. The quick actions above still apply."
      );
    } finally {
      setPlanLoading(false);
    }
  };

  const handleAskFollowUp = async (explicitQuestion?: string) => {
    const q = (explicitQuestion ?? questionInput).trim();
    if (!q || !planText || followUpLoading || planLoading) return;

    setQuestionInput("");
    setFollowUpError("");
    setFollowUpLoading(true);

    const priorHistory = [...followUps];
    const userTurn: ChatTurn = { role: "user", content: q };
    const assistantPlaceholder: ChatTurn = { role: "model", content: "" };
    setFollowUps([...priorHistory, userTurn, assistantPlaceholder]);

    try {
      const response = await fetch("./api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: buildProfilePayload(),
          plan: planText,
          history: priorHistory,
          question: q,
        }),
      });

      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || contentType.includes("text/html")) {
        throw new Error(
          await readApiError(response, "Couldn’t answer right now. Please try again.")
        );
      }

      await consumeSSEStream(response, (text) => {
        setFollowUps((prev) => {
          const next = [...prev];
          if (next.length > 0) {
            next[next.length - 1] = { role: "model", content: text };
          }
          return next;
        });
      });
    } catch (err) {
      setFollowUpError(
        err instanceof Error ? err.message : "Couldn’t answer right now. Please try again."
      );
      setFollowUps(priorHistory);
    } finally {
      setFollowUpLoading(false);
    }
  };

  const handleCopyPlan = async () => {
    if (!planText) return;
    try {
      await navigator.clipboard.writeText(planText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  const maxHourlyPm25 = useMemo(() => {
    if (!liveReading?.hourlyTrend?.length) return 100;
    const vals = liveReading.hourlyTrend
      .map((item) => item.pm25 ?? 0)
      .filter((v) => v > 0);
    return Math.max(50, ...vals);
  }, [liveReading]);

  const observedLabel = useMemo(() => {
    if (!liveReading?.observedAt) return "";
    const parsed = new Date(liveReading.observedAt);
    if (Number.isNaN(parsed.getTime())) return liveReading.observedAt;
    return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [liveReading]);

  return (
    <div className="min-h-screen bg-[#f4f7f5] text-[#17261f] dark:bg-[#0f1713] dark:text-[#e6f0ea] transition-colors duration-200">
      {/* Strict 3-zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-[#dbe5df] bg-[#f4f7f5]/95 backdrop-blur-sm dark:border-[#28382f] dark:bg-[#0f1713]/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <a
            href="#top"
            className="font-display text-base sm:text-lg font-bold tracking-tight text-[#17261f] dark:text-[#eef5f1] whitespace-nowrap shrink-0"
          >
            Urban Air Quality Assistant
          </a>

          <nav
            aria-label="Primary"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-[#52655b] dark:text-[#9bb0a5]"
          >
            <a
              href="#profile"
              className="hover:text-[#17261f] dark:hover:text-[#eef5f1] transition-colors whitespace-nowrap shrink-0"
            >
              Household
            </a>
            <a
              href="#quick-actions"
              className="hover:text-[#17261f] dark:hover:text-[#eef5f1] transition-colors whitespace-nowrap shrink-0"
            >
              Right now
            </a>
            <a
              href="#personal-plan"
              className="hover:text-[#17261f] dark:hover:text-[#eef5f1] transition-colors whitespace-nowrap shrink-0"
            >
              Personal plan
            </a>
            <a
              href="#symptom-log"
              className="hover:text-[#17261f] dark:hover:text-[#eef5f1] transition-colors whitespace-nowrap shrink-0"
            >
              Symptom log
            </a>
            <a
              href="#why-it-matters"
              className="hover:text-[#17261f] dark:hover:text-[#eef5f1] transition-colors whitespace-nowrap shrink-0"
            >
              Why it matters
            </a>
          </nav>

          <button
            type="button"
            onClick={handleBuildPlan}
            disabled={planLoading}
            className="rounded-lg bg-[#1f7a5a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#186348] dark:bg-[#4cc596] dark:text-[#06130d] dark:hover:bg-[#3eb385] transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7a5a]"
          >
            {planLoading ? "Building…" : "Build plan"}
          </button>
        </div>
      </header>

      <main id="top" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 space-y-10">
        {/* Intro Heading */}
        <section className="max-w-3xl space-y-2.5">
          <h1
            className="text-3xl sm:text-4xl font-bold tracking-tight text-[#17261f] dark:text-[#f0f6f3]"
            style={{ textWrap: "balance" }}
          >
            Practical daily air protection for your household
          </h1>
          <p className="text-base text-[#52655b] dark:text-[#9bb0a5] leading-relaxed">
            Fetch live local air quality or set today’s AQI, share how your household commutes and
            cooks, and get a low-emission daily routine with clear reasons behind every step.
          </p>
        </section>

        {/* Primary Two-Column Workspace: Profile Form (7 cols) + Live AQI & Immediate Actions (5 cols) */}
        <section
          id="profile"
          className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
        >
          {/* Left Column: Household Profile */}
          <div className="lg:col-span-7 rounded-xl border border-[#dbe5df] bg-white p-6 sm:p-7 dark:border-[#28382f] dark:bg-[#17231d]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-5 border-b border-[#e8efeb] dark:border-[#24342b]">
              <h2 className="text-lg font-semibold text-[#17261f] dark:text-[#eef5f1]">
                Household profile
              </h2>
              <span className="text-xs text-[#5a6b62] dark:text-[#9bb0a5]">
                Used to tailor your routine, indoor air hacks, and swaps
              </span>
            </div>

            <div className="mt-6 space-y-6">
              {/* Location & Live AQI Lookup */}
              <div>
                <label
                  htmlFor="city"
                  className="block text-sm font-medium text-[#2c3e35] dark:text-[#c7d6ce] mb-1.5"
                >
                  City or neighbourhood
                </label>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <input
                      id="city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          fetchLiveAqi({ city });
                        }
                      }}
                      placeholder="e.g. Lucknow, Gomti Nagar or New Delhi"
                      className="w-full rounded-lg border border-[#cfdcd5] bg-[#f8faf9] px-3.5 py-2.5 text-sm text-[#17261f] placeholder:text-[#788a80] focus:border-[#1f7a5a] focus:bg-white focus:outline-none dark:border-[#2f4237] dark:bg-[#0f1713] dark:text-[#e6f0ea] dark:placeholder:text-[#6f8579] dark:focus:border-[#4cc596]"
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => fetchLiveAqi({ city })}
                      disabled={aqiLoading || !city.trim()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#cfdcd5] bg-[#f4f7f5] px-3.5 py-2.5 text-sm font-medium text-[#17261f] hover:bg-[#e6f2ec] dark:border-[#2f4237] dark:bg-[#1d2e26] dark:text-[#e6f0ea] dark:hover:bg-[#253b31] transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {aqiLoading && !locLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      <span>Fetch live AQI</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleUseLocation}
                      disabled={locLoading || aqiLoading}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#cfdcd5] bg-[#f4f7f5] px-3.5 py-2.5 text-sm font-medium text-[#17261f] hover:bg-[#e6f2ec] dark:border-[#2f4237] dark:bg-[#1d2e26] dark:text-[#e6f0ea] dark:hover:bg-[#253b31] transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {locLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MapPin className="h-4 w-4" />
                      )}
                      <span>Use my location</span>
                    </button>
                  </div>
                </div>

                {(locationMessage || locationError) && (
                  <p
                    className={`mt-2 text-xs ${
                      locationError
                        ? "text-[#b42323] dark:text-[#f88383]"
                        : "text-[#1f7a5a] dark:text-[#6ee09c]"
                    }`}
                  >
                    {locationError || locationMessage}
                  </p>
                )}
              </div>

              {/* 2x2 Selects */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="commute"
                    className="block text-sm font-medium text-[#2c3e35] dark:text-[#c7d6ce] mb-1.5"
                  >
                    Main commute
                  </label>
                  <select
                    id="commute"
                    value={commute}
                    onChange={(e) => setCommute(e.target.value)}
                    className="w-full rounded-lg border border-[#cfdcd5] bg-[#f8faf9] px-3 py-2.5 text-sm text-[#17261f] focus:border-[#1f7a5a] focus:bg-white focus:outline-none dark:border-[#2f4237] dark:bg-[#0f1713] dark:text-[#e6f0ea] dark:focus:border-[#4cc596]"
                  >
                    {COMMUTE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="cook"
                    className="block text-sm font-medium text-[#2c3e35] dark:text-[#c7d6ce] mb-1.5"
                  >
                    Cooking and heating at home
                  </label>
                  <select
                    id="cook"
                    value={cook}
                    onChange={(e) => setCook(e.target.value)}
                    className="w-full rounded-lg border border-[#cfdcd5] bg-[#f8faf9] px-3 py-2.5 text-sm text-[#17261f] focus:border-[#1f7a5a] focus:bg-white focus:outline-none dark:border-[#2f4237] dark:bg-[#0f1713] dark:text-[#e6f0ea] dark:focus:border-[#4cc596]"
                  >
                    {COOKING_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="purifier"
                    className="block text-sm font-medium text-[#2c3e35] dark:text-[#c7d6ce] mb-1.5"
                  >
                    Indoor air equipment
                  </label>
                  <select
                    id="purifier"
                    value={purifier}
                    onChange={(e) => setPurifier(e.target.value)}
                    className="w-full rounded-lg border border-[#cfdcd5] bg-[#f8faf9] px-3 py-2.5 text-sm text-[#17261f] focus:border-[#1f7a5a] focus:bg-white focus:outline-none dark:border-[#2f4237] dark:bg-[#0f1713] dark:text-[#e6f0ea] dark:focus:border-[#4cc596]"
                  >
                    {PURIFIER_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="budget"
                    className="block text-sm font-medium text-[#2c3e35] dark:text-[#c7d6ce] mb-1.5"
                  >
                    Budget for changes
                  </label>
                  <select
                    id="budget"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    className="w-full rounded-lg border border-[#cfdcd5] bg-[#f8faf9] px-3 py-2.5 text-sm text-[#17261f] focus:border-[#1f7a5a] focus:bg-white focus:outline-none dark:border-[#2f4237] dark:bg-[#0f1713] dark:text-[#e6f0ea] dark:focus:border-[#4cc596]"
                  >
                    {BUDGET_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Household Members Multi-Select Controls */}
              <div>
                <div className="flex items-baseline justify-between gap-2 mb-2.5">
                  <span className="text-sm font-medium text-[#2c3e35] dark:text-[#c7d6ce]">
                    Who is in your household?
                  </span>
                  <span className="text-xs text-[#5a6b62] dark:text-[#9bb0a5]">
                    {selectedWho.length === 0
                      ? "Default: healthy adults"
                      : `${selectedWho.length} selected`}
                  </span>
                </div>
                <div
                  role="group"
                  aria-label="Household members"
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                >
                  {HOUSEHOLD_MEMBERS.map((member) => {
                    const active = selectedWho.includes(member.value);
                    return (
                      <button
                        key={member.value}
                        type="button"
                        role="checkbox"
                        aria-checked={active}
                        onClick={() => toggleHouseholdMember(member.value)}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors ${
                          active
                            ? "border-[#1f7a5a] bg-[#e6f2ec] text-[#124d38] font-medium dark:border-[#4cc596] dark:bg-[#1d2e26] dark:text-[#e6f0ea]"
                            : "border-[#dbe5df] bg-[#f8faf9] text-[#2c3e35] hover:bg-[#eef4f0] dark:border-[#28382f] dark:bg-[#0f1713] dark:text-[#b5c7bd] dark:hover:bg-[#1a2820]"
                        }`}
                      >
                        <span>{member.label}</span>
                        <span
                          aria-hidden="true"
                          className={`flex h-4 w-4 items-center justify-center rounded border ${
                            active
                              ? "border-[#1f7a5a] bg-[#1f7a5a] text-white dark:border-[#4cc596] dark:bg-[#4cc596] dark:text-[#06130d]"
                              : "border-[#b8c8bf] dark:border-[#3c5246]"
                          }`}
                        >
                          {active && <Check className="h-3 w-3 stroke-[3]" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Primary Action Row */}
              <div className="pt-2 flex flex-wrap items-center gap-4 border-t border-[#e8efeb] dark:border-[#24342b]">
                <button
                  type="button"
                  onClick={handleBuildPlan}
                  disabled={planLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1f7a5a] px-5 py-3 text-sm font-semibold text-white hover:bg-[#186348] dark:bg-[#4cc596] dark:text-[#06130d] dark:hover:bg-[#3eb385] transition-colors disabled:opacity-60 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f7a5a]"
                >
                  {planLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{planLoading ? "Building your plan…" : "Build my personalised plan"}</span>
                </button>
                <span className="text-xs text-[#5a6b62] dark:text-[#9bb0a5]">
                  Tailored to AQI <span className="font-mono tabular-nums font-medium">{aqi}</span> ({category.label})
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Live AQI Instrument + Right Now Quick Actions */}
          <div className="lg:col-span-5 space-y-6">
            {/* AQI Control & Live Telemetry Surface */}
            <div className="rounded-xl border border-[#dbe5df] bg-white p-6 dark:border-[#28382f] dark:bg-[#17231d]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <label
                    htmlFor="aqi-slider"
                    className="block text-xs font-medium text-[#5a6b62] dark:text-[#9bb0a5]"
                  >
                    Today’s AQI (CPCB scale 0–500)
                  </label>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="font-mono text-4xl font-semibold tracking-tight tabular-nums text-[#17261f] dark:text-[#f0f6f3]">
                      {aqi}
                    </span>
                    <span className={`text-base font-semibold ${category.textClass}`}>
                      {category.label}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-[#5a6b62] dark:text-[#9bb0a5]">
                      {category.rangeLabel}
                    </span>
                  </div>
                </div>
                {coords && (
                  <button
                    type="button"
                    onClick={() => fetchLiveAqi(coords)}
                    disabled={aqiLoading}
                    title="Refresh live AQI reading"
                    aria-label="Refresh live AQI reading"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#dbe5df] px-2.5 py-1.5 text-xs font-medium text-[#2c3e35] hover:bg-[#f4f7f5] dark:border-[#28382f] dark:text-[#c7d6ce] dark:hover:bg-[#1d2e26] transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${aqiLoading ? "animate-spin" : ""}`} />
                    <span>Refresh</span>
                  </button>
                )}
              </div>

              <p className="mt-2 text-sm text-[#52655b] dark:text-[#9bb0a5]">
                {category.summary}
              </p>

              {/* Interactive Range Slider */}
              <div className="mt-5">
                <input
                  id="aqi-slider"
                  type="range"
                  min={0}
                  max={500}
                  value={aqi}
                  onChange={(e) => setAqi(Number(e.target.value))}
                  aria-label="Today’s Air Quality Index"
                  className="aqi-slider"
                />
                <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums text-[#5a6b62] dark:text-[#8ea398]">
                  {AQI_CATEGORIES.map((band) => (
                    <span key={band.label}>{band.max}</span>
                  ))}
                </div>
              </div>

              {/* Live Pollutant Breakdown (shown when live reading loaded) */}
              {liveReading && (
                <div className="mt-5 pt-4 border-t border-[#e8efeb] dark:border-[#24342b] space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5a6b62] dark:text-[#9bb0a5]">
                    <span>
                      Dominant: <strong className="text-[#17261f] dark:text-[#eef5f1] font-medium">{liveReading.dominantPollutant}</strong>
                      {liveReading.usAqi !== null && (
                        <>
                          {" · "}US AQI{" "}
                          <span className="font-mono tabular-nums">{liveReading.usAqi}</span>
                        </>
                      )}
                    </span>
                    {observedLabel && (
                      <span className="font-mono tabular-nums">Observed {observedLabel}</span>
                    )}
                  </div>

                  <div className="grid grid-cols-4 gap-3 text-left">
                    <div>
                      <div className="text-[11px] text-[#5a6b62] dark:text-[#8ea398]">PM2.5</div>
                      <div className="font-mono text-sm font-semibold tabular-nums text-[#17261f] dark:text-[#eef5f1]">
                        {liveReading.pollutants.pm25 ?? "—"}
                        <span className="text-[10px] font-normal text-[#5a6b62] dark:text-[#8ea398] ml-0.5">
                          µg/m³
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#5a6b62] dark:text-[#8ea398]">PM10</div>
                      <div className="font-mono text-sm font-semibold tabular-nums text-[#17261f] dark:text-[#eef5f1]">
                        {liveReading.pollutants.pm10 ?? "—"}
                        <span className="text-[10px] font-normal text-[#5a6b62] dark:text-[#8ea398] ml-0.5">
                          µg/m³
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#5a6b62] dark:text-[#8ea398]">NO₂</div>
                      <div className="font-mono text-sm font-semibold tabular-nums text-[#17261f] dark:text-[#eef5f1]">
                        {liveReading.pollutants.no2 ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#5a6b62] dark:text-[#8ea398]">O₃</div>
                      <div className="font-mono text-sm font-semibold tabular-nums text-[#17261f] dark:text-[#eef5f1]">
                        {liveReading.pollutants.o3 ?? "—"}
                      </div>
                    </div>
                  </div>

                  {/* 24-hour PM2.5 Profile Bar Strip */}
                  {liveReading.hourlyTrend.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-[#5a6b62] dark:text-[#8ea398] mb-1.5">
                        <span>Today’s hourly PM2.5 profile</span>
                        <span className="font-mono tabular-nums">00:00 – 23:00</span>
                      </div>
                      <div
                        className="flex items-end gap-[3px] h-10"
                        aria-label="Hourly PM2.5 trend over 24 hours"
                      >
                        {liveReading.hourlyTrend.map((point, idx) => {
                          const val = point.pm25 ?? 0;
                          const pct = Math.max(10, Math.round((val / maxHourlyPm25) * 100));
                          const barColor =
                            val > 250
                              ? "bg-[#8b1e3f]"
                              : val > 120
                                ? "bg-[#d63b3b]"
                                : val > 90
                                  ? "bg-[#e07a1f]"
                                  : val > 60
                                    ? "bg-[#c9a400]"
                                    : "bg-[#2e9e5b]";
                          return (
                            <div
                              key={idx}
                              title={`${point.hour}: ${point.pm25 ?? "—"} µg/m³ PM2.5`}
                              className={`flex-1 rounded-t-xs ${barColor} opacity-85 hover:opacity-100 transition-opacity`}
                              style={{ height: `${pct}%` }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* External Verification Links */}
              <div className="mt-4 pt-3.5 border-t border-[#e8efeb] dark:border-[#24342b] flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#5a6b62] dark:text-[#9bb0a5]">
                <span>Check nearby stations:</span>
                <a
                  href={
                    coords
                      ? `https://waqi.info/#/c/${coords.lat.toFixed(4)}/${coords.lng.toFixed(4)}/11z`
                      : "https://waqi.info/"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#1f7a5a] hover:underline dark:text-[#4cc596]"
                >
                  <span>WAQI Map</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
                <span aria-hidden="true">·</span>
                <a
                  href="https://airquality.cpcb.gov.in/AQI_India/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#1f7a5a] hover:underline dark:text-[#4cc596]"
                >
                  <span>CPCB India</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            {/* Right Now Quick Actions */}
            <div
              id="quick-actions"
              className="rounded-xl border border-[#dbe5df] bg-white p-6 dark:border-[#28382f] dark:bg-[#17231d]"
            >
              <div className="flex items-baseline justify-between gap-2 pb-3.5 border-b border-[#e8efeb] dark:border-[#24342b]">
                <h2 className="text-base font-semibold text-[#17261f] dark:text-[#eef5f1]">
                  Right now at this AQI
                </h2>
                <span className={`text-xs font-semibold ${category.textClass}`}>
                  {category.label} · {aqi}
                </span>
              </div>

              {liveReading?.weather &&
                (liveReading.weather.temperatureC !== null ||
                  liveReading.weather.humidityPct !== null) && (
                  <div className="py-3.5 border-b border-[#e8efeb] dark:border-[#24342b] space-y-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                      {liveReading.weather.temperatureC !== null && (
                        <div>
                          <span className="text-xs text-[#5a6b62] dark:text-[#8ea398] mr-1.5">
                            Temperature
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums text-[#17261f] dark:text-[#eef5f1]">
                            {liveReading.weather.temperatureC}°C
                          </span>
                        </div>
                      )}
                      {liveReading.weather.humidityPct !== null && (
                        <div>
                          <span className="text-xs text-[#5a6b62] dark:text-[#8ea398] mr-1.5">
                            Humidity
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums text-[#17261f] dark:text-[#eef5f1]">
                            {liveReading.weather.humidityPct}%
                          </span>
                        </div>
                      )}
                      {liveReading.weather.windSpeedKmh !== null && (
                        <div>
                          <span className="text-xs text-[#5a6b62] dark:text-[#8ea398] mr-1.5">
                            Wind
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums text-[#17261f] dark:text-[#eef5f1]">
                            {liveReading.weather.windSpeedKmh} km/h
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-[#5a6b62] dark:text-[#9bb0a5] leading-snug">
                      {liveReading.weather.humidityPct !== null &&
                      liveReading.weather.humidityPct >= 70 &&
                      liveReading.weather.temperatureC !== null &&
                      liveReading.weather.temperatureC <= 18
                        ? "Cool, humid air holds moisture droplets that bind fine particulates near ground level."
                        : liveReading.weather.humidityPct !== null &&
                            liveReading.weather.humidityPct >= 75
                          ? "High humidity can swell airborne particles and keep haze lingering longer."
                          : liveReading.weather.windSpeedKmh !== null &&
                              liveReading.weather.windSpeedKmh < 7
                            ? "Light winds slow down pollutant dispersion; local emissions build up faster."
                            : "Current temperature and humidity help shape how quickly local smog disperses."}
                    </p>
                  </div>
                )}

              <ol className="mt-3 divide-y divide-[#eef3f0] dark:divide-[#233229]">
                {quickActions.map((item, idx) => (
                  <li key={item.title} className="py-3 first:pt-1 last:pb-0">
                    <div className="flex gap-3">
                      <span className="font-mono text-xs tabular-nums text-[#5a6b62] dark:text-[#8ea398] pt-0.5 shrink-0">
                        0{idx + 1}
                      </span>
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold text-[#17261f] dark:text-[#eef5f1]">
                          {item.title}
                        </p>
                        <p className="text-sm text-[#52655b] dark:text-[#a4b8ad] leading-snug">
                          {item.detail}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Personalised AI Plan Section */}
        <section
          id="personal-plan"
          ref={planSectionRef}
          className="rounded-xl border border-[#dbe5df] bg-white p-6 sm:p-8 dark:border-[#28382f] dark:bg-[#17231d]"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#e8efeb] dark:border-[#24342b]">
            <div>
              <h2 className="text-xl font-semibold text-[#17261f] dark:text-[#eef5f1]">
                Your personalised plan
              </h2>
              <p className="mt-0.5 text-sm text-[#5a6b62] dark:text-[#9bb0a5]">
                {planText
                  ? `Tailored for ${city.trim() || "your area"} · AQI ${planSnapshotAqi ?? aqi} · ${commute} · ${cook}`
                  : "Build a plan from your household profile to get a timed routine, indoor air hacks, and greener swaps."}
              </p>
            </div>

            {planText && !planLoading && (
              <div className="flex items-center gap-2 no-print">
                <button
                  type="button"
                  onClick={handleCopyPlan}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfdcd5] px-3 py-1.5 text-xs font-medium text-[#17261f] hover:bg-[#f4f7f5] dark:border-[#2f4237] dark:text-[#e6f0ea] dark:hover:bg-[#1d2e26] transition-colors whitespace-nowrap"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-[#1f7a5a]" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? "Copied" : "Copy plan"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfdcd5] px-3 py-1.5 text-xs font-medium text-[#17261f] hover:bg-[#f4f7f5] dark:border-[#2f4237] dark:text-[#e6f0ea] dark:hover:bg-[#1d2e26] transition-colors whitespace-nowrap"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Print</span>
                </button>
              </div>
            )}
          </div>

          {/* Empty State */}
          {!planText && !planLoading && !planError && (
            <div className="py-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="max-w-xl space-y-1.5">
                <p className="text-base font-medium text-[#17261f] dark:text-[#eef5f1]">
                  No personalised plan generated yet
                </p>
                <p className="text-sm text-[#5a6b62] dark:text-[#9bb0a5] leading-relaxed">
                  Review your commute, cooking fuel, equipment, and household members above, then
                  build a concise morning-to-evening plan you can follow today.
                </p>
              </div>
              <button
                type="button"
                onClick={handleBuildPlan}
                className="rounded-lg bg-[#1f7a5a] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#186348] dark:bg-[#4cc596] dark:text-[#06130d] dark:hover:bg-[#3eb385] transition-colors whitespace-nowrap shrink-0"
              >
                Build my personalised plan
              </button>
            </div>
          )}

          {/* Error State */}
          {planError && (
            <div className="mt-6 rounded-lg border border-[#d63b3b]/30 bg-[#fdf3f3] p-4 text-sm text-[#991b1b] dark:border-[#f88383]/30 dark:bg-[#2a1618] dark:text-[#fca5a5]">
              {planError}
            </div>
          )}

          {/* Initial Loading Skeleton (before first streamed tokens arrive) */}
          {planLoading && !planText && (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6" aria-busy="true">
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className="space-y-2.5 pt-4 border-t border-[#e8efeb] dark:border-[#24342b]">
                  <div className="h-4 w-40 rounded bg-[#e6efea] dark:bg-[#22332a] animate-pulse" />
                  <div className="h-3.5 w-full rounded bg-[#eef4f1] dark:bg-[#1c2b23] animate-pulse" />
                  <div className="h-3.5 w-5/6 rounded bg-[#eef4f1] dark:bg-[#1c2b23] animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {/* Populated / Streaming Plan */}
          {planText && (
            <div className="mt-4">
              <MarkdownRenderer content={planText} structuredGrid />

              {planLoading && (
                <p className="mt-4 text-xs text-[#5a6b62] dark:text-[#9bb0a5]">
                  Writing remaining sections…
                </p>
              )}

              {/* Follow-up Thread */}
              {followUps.length > 0 && (
                <div className="mt-8 pt-6 border-t border-[#dbe5df] dark:border-[#28382f] space-y-5">
                  <h3 className="text-sm font-semibold text-[#17261f] dark:text-[#eef5f1]">
                    Follow-up questions
                  </h3>
                  <div className="space-y-4">
                    {followUps.map((turn, idx) => (
                      <div key={idx}>
                        {turn.role === "user" ? (
                          <div className="inline-block rounded-lg bg-[#e6f2ec] px-3.5 py-2 text-sm font-medium text-[#17261f] dark:bg-[#1d2e26] dark:text-[#eef5f1]">
                            {turn.content}
                          </div>
                        ) : (
                          <div className="mt-2 pl-1">
                            {turn.content ? (
                              <MarkdownRenderer content={turn.content} />
                            ) : (
                              <span className="text-sm text-[#5a6b62] dark:text-[#9bb0a5]">
                                Thinking…
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {followUpError && (
                <p className="mt-3 text-sm text-[#b42323] dark:text-[#f88383]">{followUpError}</p>
              )}

              {/* Follow-up Question Input */}
              {!planLoading && (
                <div className="mt-7 pt-6 border-t border-[#e8efeb] dark:border-[#24342b] space-y-3 no-print">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[#5a6b62] dark:text-[#9bb0a5]">Try asking:</span>
                    {FOLLOWUP_SUGGESTIONS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        disabled={followUpLoading}
                        onClick={() => handleAskFollowUp(prompt)}
                        className="rounded-md border border-[#dbe5df] bg-[#f8faf9] px-2.5 py-1 text-xs text-[#2c3e35] hover:bg-[#e6f2ec] hover:border-[#1f7a5a]/40 dark:border-[#28382f] dark:bg-[#0f1713] dark:text-[#c7d6ce] dark:hover:bg-[#1d2e26] transition-colors disabled:opacity-50"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleAskFollowUp();
                    }}
                    className="flex flex-col sm:flex-row gap-2.5"
                  >
                    <input
                      type="text"
                      value={questionInput}
                      onChange={(e) => setQuestionInput(e.target.value)}
                      placeholder="Ask a follow-up, e.g. “Is it safe for my son to play outside?”"
                      aria-label="Ask a follow-up question"
                      className="flex-1 rounded-lg border border-[#cfdcd5] bg-[#f8faf9] px-3.5 py-2.5 text-sm text-[#17261f] placeholder:text-[#788a80] focus:border-[#1f7a5a] focus:bg-white focus:outline-none dark:border-[#2f4237] dark:bg-[#0f1713] dark:text-[#e6f0ea] dark:placeholder:text-[#6f8579] dark:focus:border-[#4cc596]"
                    />
                    <button
                      type="submit"
                      disabled={followUpLoading || !questionInput.trim()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#17261f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23382e] dark:bg-[#e6f0ea] dark:text-[#0f1713] dark:hover:bg-[#d3e2d9] transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {followUpLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      <span>Ask</span>
                    </button>
                  </form>
                </div>
              )}

              <p className="mt-6 pt-4 border-t border-[#e8efeb] dark:border-[#24342b] text-xs text-[#5a6b62] dark:text-[#9bb0a5]">
                General guidance only, not medical advice. If anyone has trouble breathing, chest
                pain, or worsening symptoms, contact a doctor.
              </p>
            </div>
          )}
        </section>

        {/* Symptom Log Tracker */}
        <SymptomLog
          currentAqi={aqi}
          currentLocation={city}
          liveReading={liveReading}
        />

        {/* Why Your Choices Matter Editorial Grid */}
        <section id="why-it-matters" className="space-y-5">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold text-[#17261f] dark:text-[#eef5f1]">
              Why your choices matter
            </h2>
            <p className="mt-1 text-sm text-[#5a6b62] dark:text-[#9bb0a5]">
              Everyday transport, cooking, and ventilation habits directly shift the air inside your
              home and on your street.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {IMPACT_CARDS.map((card) => (
              <article
                key={card.index}
                className="rounded-xl border border-[#dbe5df] bg-white p-5 dark:border-[#28382f] dark:bg-[#17231d]"
              >
                <span className="font-mono text-xs tabular-nums text-[#1f7a5a] dark:text-[#4cc596]">
                  {card.index}
                </span>
                <h3 className="mt-1.5 text-base font-semibold text-[#17261f] dark:text-[#eef5f1]">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#52655b] dark:text-[#a4b8ad]">
                  {card.body}
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>

      {/* Quiet Footer with Appearance Toggle */}
      <footer className="mt-12 border-t border-[#dbe5df] dark:border-[#28382f]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-6 text-xs text-[#5a6b62] dark:text-[#9bb0a5]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Urban Air Quality Assistant</span>
            <span aria-hidden="true">·</span>
            <span>Live data via Open-Meteo Air Quality API</span>
            <span aria-hidden="true">·</span>
            <span>CPCB India AQI bands (0–500)</span>
          </div>

          <button
            type="button"
            onClick={() => setDarkMode((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#dbe5df] px-3 py-1.5 text-xs font-medium text-[#17261f] hover:bg-[#e6f2ec] dark:border-[#28382f] dark:text-[#e6f0ea] dark:hover:bg-[#1d2e26] transition-colors whitespace-nowrap"
          >
            {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            <span>{darkMode ? "Light mode" : "Dark mode"}</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
