import type { LiveAqiReading } from "./aqi";

type Breakpoint = [number, number, number, number];

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

/**
 * Fetches live air quality, current temperature/humidity, and location name directly
 * from free, keyless, CORS-enabled Open-Meteo APIs so it works on any host (including static Netlify).
 */
export async function fetchOpenMeteoAqi(params: {
  lat?: number;
  lng?: number;
  city?: string;
}): Promise<LiveAqiReading> {
  let lat = typeof params.lat === "number" ? params.lat : NaN;
  let lng = typeof params.lng === "number" ? params.lng : NaN;
  const cityQuery = (params.city ?? "").trim().slice(0, 120);

  let resolvedName = cityQuery;
  let resolvedRegion = "";

  if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && cityQuery) {
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
      const geoResp = await fetch(geoUrl);
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
      throw new Error(
        `Couldn’t find "${cityQuery}". Try a nearby major city name or use your device location.`
      );
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
    throw new Error("Enter a city name or use your device location first.");
  }

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

  const revPromise = !resolvedName
    ? fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&localityLanguage=en`
      )
    : Promise.resolve(null);

  const [aqResult, weatherResult, revResult] = await Promise.allSettled([
    fetch(aqUrl.toString()),
    fetch(weatherUrl.toString()),
    revPromise,
  ]);

  if (aqResult.status !== "fulfilled" || !aqResult.value.ok) {
    throw new Error(
      "Live air quality service is temporarily unavailable. You can still set the AQI slider manually."
    );
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
      us_aqi?: number | null;
    };
    hourly?: {
      time?: string[];
      pm2_5?: Array<number | null>;
    };
  };

  let weather: LiveAqiReading["weather"] = null;
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
      // Optional weather parse failure
    }
  }

  if (!resolvedName && revResult.status === "fulfilled" && revResult.value?.ok) {
    try {
      const revData = (await revResult.value.json()) as {
        locality?: string;
        city?: string;
        principalSubdivision?: string;
        countryName?: string;
      };
      const primary = revData.city || revData.locality || "";
      const sub =
        revData.locality && revData.city && revData.locality !== revData.city
          ? revData.locality
          : "";
      resolvedName = [primary, sub].filter(Boolean).join(", ");
      resolvedRegion = [revData.principalSubdivision, revData.countryName]
        .filter(Boolean)
        .join(", ");
    } catch {
      // Non-fatal
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

  const hourlyTimes = aqData.hourly?.time ?? [];
  const hourlyPm25 = aqData.hourly?.pm2_5 ?? [];
  const hourlyTrend = hourlyTimes.slice(0, 24).map((t, idx) => ({
    hour: t.slice(11, 16),
    pm25: typeof hourlyPm25[idx] === "number" ? Math.round(hourlyPm25[idx]!) : null,
  }));

  return {
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
  };
}
