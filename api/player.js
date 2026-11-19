import { json, preflight } from "../lib/http.js";

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return preflight(request);
    if (request.method !== "GET") return json(request, { error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    const type = (url.searchParams.get("type") || "").toLowerCase();
    const id = (url.searchParams.get("id") || "").trim();
    const season = Math.max(1, Number.parseInt(url.searchParams.get("season") || "1", 10) || 1);
    const episode = Math.max(1, Number.parseInt(url.searchParams.get("episode") || "1", 10) || 1);
    if (!id) return json(request, { error: "id is required" }, 400);
    if (type === "movie") return json(request, { provider: "vidlink", mode: "embed", url: `https://vidlink.pro/movie/${encodeURIComponent(id)}` });
    if (type === "tv") return json(request, { provider: "vidlink", mode: "embed", url: `https://vidlink.pro/tv/${encodeURIComponent(id)}/${season}/${episode}` });
    return json(request, { error: "type must be movie or tv" }, 400);
  },
};
