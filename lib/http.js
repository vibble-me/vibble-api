export function responseHeaders(request, extra = {}) {
  const origin = request.headers.get("origin") || "";
  const allowed = (process.env.CORS_ORIGINS || "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    "Vary": "Origin",
    ...extra,
  };
}

export function json(request, data, status = 200) {
  return Response.json(data, { status, headers: responseHeaders(request) });
}

export function preflight(request) {
  return new Response(null, { status: 204, headers: responseHeaders(request) });
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : "Unexpected upstream error";
}

export async function fetchJson(url, options = {}, label = "Upstream request") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
