import { json, preflight, errorMessage } from "../lib/http.js";
import { searchAnime } from "../lib/anime.js";
import { searchTmdb } from "../lib/tmdb.js";

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return preflight(request);
    if (request.method !== "GET") return json(request, { error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    const type = (url.searchParams.get("type") || "").toLowerCase();
    const query = (url.searchParams.get("query") || url.searchParams.get("keyword") || "").trim();
    if (!query) return json(request, { error: "A non-empty query is required" }, 400);
    if (!["anime", "cartoons", "movies", "tv"].includes(type)) return json(request, { error: "type must be anime, cartoons, movies, or tv" }, 400);
    try {
      if (type === "anime") {
        try {
          const items = await searchAnime(query);
          if (items.length) return json(request, { source: "anisuge", type, query, count: items.length, items });
        } catch (error) {
          console.warn("AnimeSuge search failed; using TMDB fallback:", errorMessage(error));
        }
        const items = await searchTmdb("anime", query);
        return json(request, { source: "tmdb-fallback", type, query, count: items.length, items });
      }
      const items = await searchTmdb(type, query);
      return json(request, { source: "tmdb", type, query, count: items.length, items });
    } catch (error) {
      console.error("Search request failed:", errorMessage(error));
      return json(request, { error: "Search request failed", details: errorMessage(error) }, 502);
    }
  },
};
