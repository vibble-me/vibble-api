import { json, preflight, errorMessage } from "../lib/http.js";
import { getTvSeason } from "../lib/tmdb.js";

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return preflight(request);
    if (request.method !== "GET") return json(request, { error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    const id = (url.searchParams.get("id") || "").trim();
    const season = Number.parseInt(url.searchParams.get("season") || "1", 10);
    if (!/^\d+$/.test(id) || !Number.isInteger(season) || season < 0) return json(request, { error: "Valid id and season are required" }, 400);
    try { return json(request, await getTvSeason(id, season)); }
    catch (error) { console.error("TV season request failed:", errorMessage(error)); return json(request, { error: "TV season request failed" }, 502); }
  },
};
