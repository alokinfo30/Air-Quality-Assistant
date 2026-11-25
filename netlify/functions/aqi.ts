import { fetchOpenMeteoAqi } from "../../src/lib/liveAqiClient";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const latParam = url.searchParams.get("lat");
  const lngParam = url.searchParams.get("lng");
  const cityParam = url.searchParams.get("city") ?? undefined;

  const lat = latParam !== null ? Number(latParam) : undefined;
  const lng = lngParam !== null ? Number(lngParam) : undefined;

  try {
    const reading = await fetchOpenMeteoAqi({ lat, lng, city: cityParam });
    return new Response(JSON.stringify(reading), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to fetch live air quality readings right now.";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
