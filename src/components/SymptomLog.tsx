import React, { useEffect, useMemo, useState } from "react";
import { Check, Download, Plus, Trash2 } from "lucide-react";
import {
  COMMON_SYMPTOMS,
  SYMPTOM_SEVERITIES,
  getAqiCategory,
  type LiveAqiReading,
  type SymptomLogEntry,
  type SymptomSeverity,
} from "../lib/aqi";

const STORAGE_KEY = "uaq-symptom-log-v1";

interface SymptomLogProps {
  currentAqi: number;
  currentLocation: string;
  liveReading: LiveAqiReading | null;
}

function loadEntries(): SymptomLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SymptomLogEntry =>
        item &&
        typeof item.id === "string" &&
        typeof item.recordedAt === "string" &&
        typeof item.aqi === "number" &&
        typeof item.severity === "number"
    );
  } catch {
    return [];
  }
}

function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortAxisDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function SymptomLog({
  currentAqi,
  currentLocation,
  liveReading,
}: SymptomLogProps) {
  const [entries, setEntries] = useState<SymptomLogEntry[]>(() => loadEntries());
  const [severity, setSeverity] = useState<SymptomSeverity>(0);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Ignore storage quota errors
    }
  }, [entries]);

  const currentCategory = useMemo(() => getAqiCategory(currentAqi), [currentAqi]);

  const toggleSymptom = (symptom: string) => {
    setSelectedSymptoms((prev) => {
      const exists = prev.includes(symptom);
      const next = exists ? prev.filter((s) => s !== symptom) : [...prev, symptom];
      if (!exists && severity === 0) {
        setSeverity(1);
      }
      return next;
    });
  };

  const handleSelectSeverity = (level: SymptomSeverity) => {
    setSeverity(level);
    if (level === 0) {
      setSelectedSymptoms([]);
    }
  };

  const handleAddEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const locationLabel =
      currentLocation.trim() ||
      liveReading?.location.name ||
      "Local area";

    const newEntry: SymptomLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      recordedAt: new Date().toISOString(),
      aqi: currentAqi,
      category: currentCategory.label,
      location: locationLabel,
      severity,
      symptoms: severity === 0 ? [] : selectedSymptoms,
      note: note.trim().slice(0, 200),
      temperatureC: liveReading?.weather?.temperatureC ?? null,
      humidityPct: liveReading?.weather?.humidityPct ?? null,
    };

    setEntries((prev) => [newEntry, ...prev].slice(0, 100));
    setNote("");
    setSelectedSymptoms([]);
    setSeverity(0);
    setConfirmClear(false);
  };

  const handleDeleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setEntries([]);
    setConfirmClear(false);
  };

  const handleExportCsv = () => {
    if (entries.length === 0) return;
    const headers = [
      "Date",
      "Location",
      "AQI",
      "Category",
      "Severity",
      "Symptoms",
      "Temperature (C)",
      "Humidity (%)",
      "Note",
    ];
    const escapeCell = (val: string | number | null | undefined) => {
      const str = val === null || val === undefined ? "" : String(val);
      return `"${str.replace(/"/g, '""')}"`;
    };
    const rows = entries.map((entry) => {
      const sev = SYMPTOM_SEVERITIES.find((s) => s.level === entry.severity)?.label ?? "";
      return [
        entry.recordedAt,
        entry.location,
        entry.aqi,
        entry.category,
        sev,
        entry.symptoms.join("; "),
        entry.temperatureC ?? "",
        entry.humidityPct ?? "",
        entry.note,
      ]
        .map(escapeCell)
        .join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `symptom-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Chronological entries (oldest -> newest) for trend chart, max 14 most recent
  const chartEntries = useMemo(() => {
    return [...entries].reverse().slice(-14);
  }, [entries]);

  // Personal pattern summary derived strictly from logged entries
  const trendSummary = useMemo(() => {
    if (entries.length === 0) return null;
    const avgAqi = Math.round(
      entries.reduce((sum, item) => sum + item.aqi, 0) / entries.length
    );
    const symptomaticEntries = entries.filter((item) => item.severity >= 1);
    const lowestSymptomaticAqi =
      symptomaticEntries.length > 0
        ? Math.min(...symptomaticEntries.map((item) => item.aqi))
        : null;

    const symptomCounts = new Map<string, number>();
    for (const entry of entries) {
      for (const s of entry.symptoms) {
        symptomCounts.set(s, (symptomCounts.get(s) ?? 0) + 1);
      }
    }
    let topSymptom: string | null = null;
    let topCount = 0;
    for (const [name, count] of symptomCounts.entries()) {
      if (count > topCount) {
        topSymptom = name;
        topCount = count;
      }
    }

    return {
      total: entries.length,
      avgAqi,
      symptomaticCount: symptomaticEntries.length,
      lowestSymptomaticAqi,
      topSymptom,
    };
  }, [entries]);

  // SVG chart geometry
  const chartWidth = 560;
  const chartHeight = 180;
  const padLeft = 36;
  const padRight = 32;
  const padTop = 16;
  const padBottom = 28;
  const innerW = chartWidth - padLeft - padRight;
  const innerH = chartHeight - padTop - padBottom;

  const points = useMemo(() => {
    if (chartEntries.length === 0) return [];
    const step =
      chartEntries.length === 1 ? 0 : innerW / (chartEntries.length - 1);
    return chartEntries.map((entry, idx) => {
      const x =
        chartEntries.length === 1
          ? padLeft + innerW / 2
          : padLeft + idx * step;
      const aqiY = padTop + innerH - (Math.min(500, entry.aqi) / 500) * innerH;
      const sevY = padTop + innerH - (entry.severity / 3) * innerH;
      return { entry, x, aqiY, sevY };
    });
  }, [chartEntries, innerW, innerH]);

  const severityLinePath = useMemo(() => {
    if (points.length < 2) return "";
    return points
      .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.sevY.toFixed(1)}`)
      .join(" ");
  }, [points]);

  return (
    <section
      id="symptom-log"
      className="rounded-xl border border-[#dbe5df] bg-white p-6 sm:p-8 dark:border-[#28382f] dark:bg-[#17231d]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-4 pb-5 border-b border-[#e8efeb] dark:border-[#24342b]">
        <div>
          <h2 className="text-xl font-semibold text-[#17261f] dark:text-[#eef5f1]">
            Symptom log
          </h2>
          <p className="mt-0.5 text-sm text-[#5a6b62] dark:text-[#9bb0a5]">
            Record how you feel at today’s AQI to track personal sensitivity patterns over time.
            Saved locally on this device.
          </p>
        </div>

        {entries.length > 0 && (
          <div className="flex items-center gap-2 no-print">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfdcd5] px-3 py-1.5 text-xs font-medium text-[#17261f] hover:bg-[#f4f7f5] dark:border-[#2f4237] dark:text-[#e6f0ea] dark:hover:bg-[#1d2e26] transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              onBlur={() => setConfirmClear(false)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                confirmClear
                  ? "border-[#d63b3b] bg-[#fdf3f3] text-[#a32222] dark:border-[#f88383] dark:bg-[#2a1618] dark:text-[#fca5a5]"
                  : "border-[#cfdcd5] text-[#5a6b62] hover:text-[#17261f] hover:bg-[#f4f7f5] dark:border-[#2f4237] dark:text-[#9bb0a5] dark:hover:text-[#e6f0ea] dark:hover:bg-[#1d2e26]"
              }`}
            >
              {confirmClear ? "Confirm clear" : "Clear log"}
            </button>
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Quick Check-in Form (5 cols) */}
        <form onSubmit={handleAddEntry} className="lg:col-span-5 space-y-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#5a6b62] dark:text-[#9bb0a5]">
            <span>Logging at</span>
            <strong className="font-mono tabular-nums text-[#17261f] dark:text-[#eef5f1]">
              AQI {currentAqi}
            </strong>
            <span className={`font-medium ${currentCategory.textClass}`}>
              ({currentCategory.label})
            </span>
            {liveReading?.weather?.temperatureC !== null &&
              liveReading?.weather?.temperatureC !== undefined && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {liveReading.weather.temperatureC}°C
                  </span>
                </>
              )}
            {liveReading?.weather?.humidityPct !== null &&
              liveReading?.weather?.humidityPct !== undefined && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {liveReading.weather.humidityPct}% RH
                  </span>
                </>
              )}
          </div>

          {/* Severity Segmented Control */}
          <div>
            <span className="block text-sm font-medium text-[#2c3e35] dark:text-[#c7d6ce] mb-2">
              How do you feel right now?
            </span>
            <div
              role="radiogroup"
              aria-label="Symptom severity"
              className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-2"
            >
              {SYMPTOM_SEVERITIES.map((opt) => {
                const active = severity === opt.level;
                return (
                  <button
                    key={opt.level}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => handleSelectSeverity(opt.level)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors whitespace-nowrap ${
                      active
                        ? "border-[#1f7a5a] bg-[#e6f2ec] font-semibold text-[#124d38] dark:border-[#4cc596] dark:bg-[#1d2e26] dark:text-[#eef5f1]"
                        : "border-[#dbe5df] bg-[#f8faf9] text-[#2c3e35] hover:bg-[#eef4f0] dark:border-[#28382f] dark:bg-[#0f1713] dark:text-[#b5c7bd] dark:hover:bg-[#1a2820]"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Specific Symptoms */}
          <div>
            <span className="block text-sm font-medium text-[#2c3e35] dark:text-[#c7d6ce] mb-2">
              Any specific symptoms? (optional)
            </span>
            <div
              role="group"
              aria-label="Specific symptoms"
              className="grid grid-cols-2 gap-1.5"
            >
              {COMMON_SYMPTOMS.map((symptom) => {
                const checked = selectedSymptoms.includes(symptom);
                return (
                  <button
                    key={symptom}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleSymptom(symptom)}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                      checked
                        ? "border-[#1f7a5a] bg-[#e6f2ec] font-medium text-[#124d38] dark:border-[#4cc596] dark:bg-[#1d2e26] dark:text-[#eef5f1]"
                        : "border-[#dbe5df] bg-[#f8faf9] text-[#2c3e35] hover:bg-[#eef4f0] dark:border-[#28382f] dark:bg-[#0f1713] dark:text-[#b5c7bd] dark:hover:bg-[#1a2820]"
                    }`}
                  >
                    <span className="truncate">{symptom}</span>
                    <span
                      aria-hidden="true"
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        checked
                          ? "border-[#1f7a5a] bg-[#1f7a5a] text-white dark:border-[#4cc596] dark:bg-[#4cc596] dark:text-[#06130d]"
                          : "border-[#b8c8bf] dark:border-[#3c5246]"
                      }`}
                    >
                      {checked && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Note */}
          <div>
            <label
              htmlFor="symptom-note"
              className="block text-sm font-medium text-[#2c3e35] dark:text-[#c7d6ce] mb-1.5"
            >
              Context note (optional)
            </label>
            <input
              id="symptom-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="e.g. Morning commute on two-wheeler, wore N95"
              className="w-full rounded-lg border border-[#cfdcd5] bg-[#f8faf9] px-3.5 py-2 text-sm text-[#17261f] placeholder:text-[#788a80] focus:border-[#1f7a5a] focus:bg-white focus:outline-none dark:border-[#2f4237] dark:bg-[#0f1713] dark:text-[#e6f0ea] dark:placeholder:text-[#6f8579] dark:focus:border-[#4cc596]"
            />
          </div>

          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#17261f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23382e] dark:bg-[#e6f0ea] dark:text-[#0f1713] dark:hover:bg-[#d3e2d9] transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Record check-in</span>
          </button>
        </form>

        {/* Right: Trend Chart & History Table (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {entries.length === 0 ? (
            <div className="border-t lg:border-t-0 lg:border-l border-[#e8efeb] dark:border-[#24342b] pt-6 lg:pt-0 lg:pl-8 py-4 space-y-2">
              <p className="text-base font-medium text-[#17261f] dark:text-[#eef5f1]">
                No check-ins recorded yet
              </p>
              <p className="text-sm text-[#5a6b62] dark:text-[#9bb0a5] leading-relaxed max-w-md">
                Log how you feel once or twice a day alongside the current AQI. Over a few days,
                your personal AQI-vs-symptom trend chart will appear here to help you spot the
                threshold where symptoms begin.
              </p>
            </div>
          ) : (
            <div className="border-t lg:border-t-0 lg:border-l border-[#e8efeb] dark:border-[#24342b] pt-6 lg:pt-0 lg:pl-8 space-y-6">
              {/* Summary Metrics Row (unboxed tabular figures) */}
              {trendSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-4 border-b border-[#e8efeb] dark:border-[#24342b]">
                  <div>
                    <div className="text-xs text-[#5a6b62] dark:text-[#8ea398]">Check-ins</div>
                    <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-[#17261f] dark:text-[#eef5f1]">
                      {trendSummary.total}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#5a6b62] dark:text-[#8ea398]">Average AQI</div>
                    <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-[#17261f] dark:text-[#eef5f1]">
                      {trendSummary.avgAqi}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#5a6b62] dark:text-[#8ea398]">
                      Lowest AQI w/ symptoms
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-[#17261f] dark:text-[#eef5f1]">
                      {trendSummary.lowestSymptomaticAqi !== null
                        ? trendSummary.lowestSymptomaticAqi
                        : "None"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#5a6b62] dark:text-[#8ea398]">Most frequent</div>
                    <div className="mt-0.5 text-sm font-semibold text-[#17261f] dark:text-[#eef5f1] truncate">
                      {trendSummary.topSymptom ?? "None logged"}
                    </div>
                  </div>
                </div>
              )}

              {/* AQI vs Symptom Severity SVG Trend Visualization */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-[#17261f] dark:text-[#eef5f1]">
                    AQI exposure vs. symptom severity (last {chartEntries.length})
                  </span>
                  <div className="flex items-center gap-4 text-[11px] text-[#5a6b62] dark:text-[#9bb0a5]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#1f7a5a]/30 dark:bg-[#4cc596]/30 border border-[#1f7a5a]/60" />
                      AQI bar (0–500)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-3.5 bg-[#17261f] dark:bg-[#eef5f1]" />
                      Symptom level (0–3)
                    </span>
                  </div>
                </div>

                <div className="w-full overflow-x-auto">
                  <svg
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    className="w-full h-auto min-w-[360px]"
                    role="img"
                    aria-label="Chart comparing recorded AQI bars against symptom severity levels over time"
                  >
                    {/* Horizontal grid lines for severity levels 0, 1, 2, 3 */}
                    {[0, 1, 2, 3].map((lvl) => {
                      const y = padTop + innerH - (lvl / 3) * innerH;
                      const aqiTick = Math.round((lvl / 3) * 500);
                      return (
                        <g key={lvl}>
                          <line
                            x1={padLeft}
                            x2={chartWidth - padRight}
                            y1={y}
                            y2={y}
                            stroke="currentColor"
                            className="text-[#e3ece7] dark:text-[#23332a]"
                            strokeWidth={1}
                          />
                          <text
                            x={padLeft - 6}
                            y={y + 3.5}
                            textAnchor="end"
                            className="fill-[#5a6b62] dark:fill-[#8ea398] text-[10px] font-mono"
                          >
                            {aqiTick}
                          </text>
                          <text
                            x={chartWidth - padRight + 6}
                            y={y + 3.5}
                            textAnchor="start"
                            className="fill-[#5a6b62] dark:fill-[#8ea398] text-[10px] font-mono"
                          >
                            {lvl}
                          </text>
                        </g>
                      );
                    })}

                    {/* AQI bars */}
                    {points.map(({ entry, x, aqiY }) => {
                      const cat = getAqiCategory(entry.aqi);
                      const barW = Math.min(26, Math.max(10, innerW / Math.max(points.length * 1.8, 4)));
                      const barH = Math.max(2, padTop + innerH - aqiY);
                      return (
                        <rect
                          key={`bar-${entry.id}`}
                          x={x - barW / 2}
                          y={aqiY}
                          width={barW}
                          height={barH}
                          rx={3}
                          fill={cat.color}
                          opacity={0.32}
                        >
                          <title>
                            {formatEntryDate(entry.recordedAt)} · AQI {entry.aqi} ({entry.category})
                          </title>
                        </rect>
                      );
                    })}

                    {/* Symptom severity trend line */}
                    {severityLinePath && (
                      <path
                        d={severityLinePath}
                        fill="none"
                        stroke="currentColor"
                        className="text-[#17261f] dark:text-[#eef5f1]"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {/* Symptom severity points + X labels */}
                    {points.map(({ entry, x, sevY }, idx) => {
                      const sevObj =
                        SYMPTOM_SEVERITIES.find((s) => s.level === entry.severity) ??
                        SYMPTOM_SEVERITIES[0];
                      const showLabel =
                        points.length <= 6 ||
                        idx === 0 ||
                        idx === points.length - 1 ||
                        idx % Math.ceil(points.length / 5) === 0;
                      return (
                        <g key={`pt-${entry.id}`}>
                          <circle
                            cx={x}
                            cy={sevY}
                            r={4.5}
                            fill={sevObj.color}
                            stroke="currentColor"
                            className="text-white dark:text-[#17231d]"
                            strokeWidth={2}
                          >
                            <title>
                              {formatEntryDate(entry.recordedAt)} · {sevObj.label} at AQI {entry.aqi}
                              {entry.symptoms.length ? ` (${entry.symptoms.join(", ")})` : ""}
                            </title>
                          </circle>
                          {showLabel && (
                            <text
                              x={x}
                              y={chartHeight - 6}
                              textAnchor="middle"
                              className="fill-[#5a6b62] dark:fill-[#8ea398] text-[10px] font-mono"
                            >
                              {formatShortAxisDate(entry.recordedAt)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* Recent Entries Log List */}
              <div>
                <h3 className="text-xs font-semibold text-[#17261f] dark:text-[#eef5f1] mb-2">
                  Recent check-ins
                </h3>
                <div className="divide-y divide-[#eef3f0] dark:divide-[#233229] max-h-72 overflow-y-auto pr-1">
                  {entries.map((entry) => {
                    const sevObj =
                      SYMPTOM_SEVERITIES.find((s) => s.level === entry.severity) ??
                      SYMPTOM_SEVERITIES[0];
                    const cat = getAqiCategory(entry.aqi);
                    return (
                      <div
                        key={entry.id}
                        className="py-3 flex items-start justify-between gap-3 text-sm"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                            <span className="font-mono tabular-nums text-[#5a6b62] dark:text-[#8ea398]">
                              {formatEntryDate(entry.recordedAt)}
                            </span>
                            <span aria-hidden="true" className="text-[#b8c8bf] dark:text-[#3c5246]">
                              ·
                            </span>
                            <span className="font-mono font-semibold tabular-nums text-[#17261f] dark:text-[#eef5f1]">
                              AQI {entry.aqi}
                            </span>
                            <span className={`font-medium ${cat.textClass}`}>{entry.category}</span>
                            <span aria-hidden="true" className="text-[#b8c8bf] dark:text-[#3c5246]">
                              ·
                            </span>
                            <span className={`font-semibold ${sevObj.textClass}`}>
                              {sevObj.label}
                            </span>
                            {entry.temperatureC !== null && entry.temperatureC !== undefined && (
                              <>
                                <span aria-hidden="true" className="text-[#b8c8bf] dark:text-[#3c5246]">
                                  ·
                                </span>
                                <span className="font-mono tabular-nums text-[#5a6b62] dark:text-[#8ea398]">
                                  {entry.temperatureC}°C
                                  {entry.humidityPct !== null && entry.humidityPct !== undefined
                                    ? ` / ${entry.humidityPct}%`
                                    : ""}
                                </span>
                              </>
                            )}
                          </div>

                          {entry.symptoms.length > 0 && (
                            <p className="text-xs text-[#2c3e35] dark:text-[#c7d6ce]">
                              {entry.symptoms.join(" · ")}
                            </p>
                          )}

                          {entry.note && (
                            <p className="text-xs text-[#5a6b62] dark:text-[#9bb0a5]">
                              {entry.note}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteEntry(entry.id)}
                          aria-label={`Delete check-in from ${formatEntryDate(entry.recordedAt)}`}
                          className="rounded p-1.5 text-[#788a80] hover:text-[#b42323] hover:bg-[#fdf3f3] dark:text-[#6f8579] dark:hover:text-[#f88383] dark:hover:bg-[#2a1618] transition-colors shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
