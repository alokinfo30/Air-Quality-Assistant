export interface AqiCategory {
  max: number;
  rangeLabel: string;
  label: string;
  color: string;
  textClass: string;
  surfaceClass: string;
  summary: string;
}

export const AQI_CATEGORIES: AqiCategory[] = [
  {
    max: 50,
    rangeLabel: "0–50",
    label: "Good",
    color: "#2e9e5b",
    textClass: "text-[#1d6e3f] dark:text-[#6ee09c]",
    surfaceClass: "bg-[#2e9e5b]",
    summary: "Minimal impact. Air is clean for outdoor routines and full ventilation.",
  },
  {
    max: 100,
    rangeLabel: "51–100",
    label: "Satisfactory",
    color: "#7aa62b",
    textClass: "text-[#4e6f14] dark:text-[#b5db69]",
    surfaceClass: "bg-[#7aa62b]",
    summary: "Acceptable for most households; sensitive individuals should stay alert.",
  },
  {
    max: 200,
    rangeLabel: "101–200",
    label: "Moderate",
    color: "#c9a400",
    textClass: "text-[#856b00] dark:text-[#f0d14f]",
    surfaceClass: "bg-[#b08f00]",
    summary: "Noticeable particulate load; time outdoor exercise and ventilation carefully.",
  },
  {
    max: 300,
    rangeLabel: "201–300",
    label: "Poor",
    color: "#e07a1f",
    textClass: "text-[#a65108] dark:text-[#f6a55b]",
    surfaceClass: "bg-[#c86610]",
    summary: "Prolonged exposure causes breathing discomfort for most people.",
  },
  {
    max: 400,
    rangeLabel: "301–400",
    label: "Very poor",
    color: "#d63b3b",
    textClass: "text-[#a32222] dark:text-[#f88383]",
    surfaceClass: "bg-[#c42b2b]",
    summary: "Respiratory illness risk on prolonged exposure; shift activities indoors.",
  },
  {
    max: 500,
    rangeLabel: "401–500",
    label: "Severe",
    color: "#8b1e3f",
    textClass: "text-[#7a1634] dark:text-[#f08aa8]",
    surfaceClass: "bg-[#8b1e3f]",
    summary: "Affects healthy people and seriously impacts vulnerable household members.",
  },
];

export function getAqiCategory(value: number): AqiCategory {
  return AQI_CATEGORIES.find((c) => value <= c.max) ?? AQI_CATEGORIES[AQI_CATEGORIES.length - 1];
}

export interface QuickAction {
  title: string;
  detail: string;
}

export const QUICK_ACTIONS: Record<string, QuickAction[]> = {
  Good: [
    {
      title: "Go outside freely",
      detail: "Normal outdoor activity is fine. Good day to air out the home fully.",
    },
    {
      title: "Keep it clean",
      detail: "Walk, cycle or take transit to keep local street air clean.",
    },
  ],
  Satisfactory: [
    {
      title: "Open windows",
      detail: "Ventilate rooms for 15–20 minutes at midday when dispersion improves.",
    },
    {
      title: "Sensitive people",
      detail: "Those with asthma or lung conditions should keep reliever medicines handy.",
    },
  ],
  Moderate: [
    {
      title: "Shift exercise",
      detail: "Move jogging and children’s play to midday, away from busy arterial roads.",
    },
    {
      title: "Ventilate midday",
      detail: "Air rooms briefly when traffic is lighter, then close windows before dusk.",
    },
    {
      title: "Cook smart",
      detail: "Run the kitchen exhaust fan or crack a window while cooking.",
    },
  ],
  Poor: [
    {
      title: "Limit long outdoor time",
      detail: "Keep children’s and older adults’ outdoor time short and low-exertion.",
    },
    {
      title: "Mask for commutes",
      detail: "Wear a snug N95/FFP2 respirator along busy roads and open vehicles.",
    },
    {
      title: "Run the purifier",
      detail: "If you have one, run it in the bedroom with doors and windows closed.",
    },
    {
      title: "Skip burning",
      detail: "Don’t burn waste, dry leaves or wood. It adds smoke directly to your own air.",
    },
  ],
  "Very poor": [
    {
      title: "Exercise indoors",
      detail: "Replace outdoor workouts, walks and sports with indoor movement.",
    },
    {
      title: "Keep windows shut",
      detail: "Close windows tightly during morning and evening inversion peaks.",
    },
    {
      title: "N95 outdoors",
      detail: "For any essential trip outside, wear a well-fitted N95/FFP2 mask.",
    },
    {
      title: "Protect the vulnerable",
      detail: "Children, older adults, and people with heart or lung conditions should stay indoors.",
    },
    {
      title: "Damp-mop surfaces",
      detail: "Wet-wipe floors and counters instead of dry sweeping, which resuspends fine dust.",
    },
  ],
  Severe: [
    {
      title: "Stay in",
      detail: "Avoid all non-essential outdoor activity until particulate levels drop.",
    },
    {
      title: "One clean room",
      detail: "Pick one bedroom, seal door gaps with rolled towels, and run a purifier there.",
    },
    {
      title: "Cancel outdoor plans",
      detail: "School sports, morning walks and open-air market trips can wait.",
    },
    {
      title: "Watch symptoms",
      detail: "Persistent cough, wheeze, chest tightness or dizziness: contact a doctor promptly.",
    },
    {
      title: "Don’t add indoor smoke",
      detail: "Skip incense, candles or open flames. Stick to induction or LPG with exhaust.",
    },
  ],
};

export const COMMUTE_OPTIONS = [
  "Private car",
  "Two-wheeler",
  "Auto/cab",
  "Bus/metro",
  "Walk/cycle",
  "Work from home",
];

export const COOKING_OPTIONS = [
  "LPG",
  "Induction/electric",
  "Firewood/coal/cow-dung cakes",
  "Electric heater/geyser",
  "Gas heater",
];

export const PURIFIER_OPTIONS = [
  "None",
  "Air purifier (HEPA)",
  "Exhaust fan only",
  "Indoor plants only",
];

export const BUDGET_OPTIONS = ["Free / very low", "Moderate", "Flexible"];

export const HOUSEHOLD_MEMBERS = [
  { value: "young children", label: "Young children" },
  { value: "older adults", label: "Older adults" },
  { value: "asthma or other lung conditions", label: "Asthma / lung condition" },
  { value: "heart conditions", label: "Heart condition" },
  { value: "pregnancy", label: "Pregnancy" },
  { value: "outdoor workers", label: "Outdoor workers" },
];

export interface ImpactCard {
  index: string;
  title: string;
  body: string;
  highlight?: string;
}

export const IMPACT_CARDS: ImpactCard[] = [
  {
    index: "01",
    title: "Car → metro, bus or carpool",
    body: "Fewer vehicles means less tailpipe exhaust and resuspended road dust. Traffic is a major local source of fine particles (PM2.5) in cities, so each swapped trip improves your own street air.",
  },
  {
    index: "02",
    title: "Not burning waste or leaves",
    body: "Open burning releases dense smoke right at ground level where families breathe it. Skipping a single burn removes an immediate pollution source next to your home.",
  },
  {
    index: "03",
    title: "Induction or LPG instead of wood or coal",
    body: "Solid-fuel cooking is one of the largest sources of indoor PM2.5. Cleaner fuel lowers exposure for the person cooking and everyone sharing indoor rooms.",
  },
  {
    index: "04",
    title: "Ventilating at the right time",
    body: "Winter urban air is usually worst in early morning and late evening inversions. Airing rooms briefly at midday dilutes indoor pollutants without pulling in peak smog.",
  },
  {
    index: "05",
    title: "Well-fitted N95/FFP2 mask",
    body: "Cloth and loose surgical masks barely stop fine particles. A snug N95 or FFP2 filters most fine particulates, provided the edges seal smoothly against the face.",
  },
  {
    index: "06",
    title: "Sharing what you learn",
    body: "Urban smog is a shared problem. Neighbours who skip burning, cook cleaner and avoid engine idling add up to noticeably cleaner air for the entire lane.",
  },
];

export const FOLLOWUP_SUGGESTIONS = [
  "Is it safe for children to play outside at midday?",
  "How can I seal a room without buying an air purifier?",
  "What is the best time to open windows today?",
];

export interface LiveAqiReading {
  location: {
    name: string;
    region: string;
    lat: number;
    lng: number;
  };
  aqi: number;
  usAqi: number | null;
  dominantPollutant: string;
  observedAt: string;
  timezone: string;
  pollutants: {
    pm25: number | null;
    pm10: number | null;
    no2: number | null;
    o3: number | null;
    so2: number | null;
  };
  weather?: {
    temperatureC: number | null;
    humidityPct: number | null;
    windSpeedKmh: number | null;
  } | null;
  hourlyTrend: Array<{ hour: string; pm25: number | null }>;
}

export type SymptomSeverity = 0 | 1 | 2 | 3;

export interface SeverityOption {
  level: SymptomSeverity;
  label: string;
  shortLabel: string;
  color: string;
  textClass: string;
}

export const SYMPTOM_SEVERITIES: SeverityOption[] = [
  {
    level: 0,
    label: "Feeling fine",
    shortLabel: "None",
    color: "#2e9e5b",
    textClass: "text-[#1d6e3f] dark:text-[#6ee09c]",
  },
  {
    level: 1,
    label: "Mild",
    shortLabel: "Mild",
    color: "#c9a400",
    textClass: "text-[#856b00] dark:text-[#f0d14f]",
  },
  {
    level: 2,
    label: "Moderate",
    shortLabel: "Moderate",
    color: "#e07a1f",
    textClass: "text-[#a65108] dark:text-[#f6a55b]",
  },
  {
    level: 3,
    label: "Significant",
    shortLabel: "Significant",
    color: "#d63b3b",
    textClass: "text-[#a32222] dark:text-[#f88383]",
  },
];

export const COMMON_SYMPTOMS = [
  "Dry cough",
  "Throat irritation",
  "Eye irritation",
  "Shortness of breath",
  "Wheezing",
  "Nasal congestion",
  "Headache",
  "Fatigue",
];

export interface SymptomLogEntry {
  id: string;
  recordedAt: string;
  aqi: number;
  category: string;
  location: string;
  severity: SymptomSeverity;
  symptoms: string[];
  note: string;
  temperatureC?: number | null;
  humidityPct?: number | null;
}

