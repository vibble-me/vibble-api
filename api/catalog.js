import { json, preflight, errorMessage } from "../lib/http.js";
import { discover } from "../lib/tmdb.js";
import { latestAnime } from "../lib/anime.js";

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return preflight(request);
    if (request.method !== "GET") return json(request, { error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    const type = (url.searchParams.get("type") || "anime").toLowerCase();
    const limit = Math.min(6, Number.parseInt(url.searchParams.get("limit") || "6", 10) || 6);
    try {
      if (type === "anime") {
        try {
          const items = await latestAnime();
          if (items.length) return json(request, { source: "anisuge", type, count: items.length, items });
        } catch (error) {
          console.warn("AnimeSuge catalogue failed; using TMDB anime fallback:", errorMessage(error));
        }
        // Vidlink is a player, not a catalogue. TMDB supplies IDs/titles;
        // each returned movie can then be opened in Vidlink.
        const items = await discover("movies", { limit });
        return json(request, { source: "tmdb-vidlink-fallback", type: "movies", count: items.length, items });
      }
      if (!["movies", "tv", "cartoons"].includes(type)) return json(request, { error: "type must be anime, movies, tv, or cartoons" }, 400);
      const items = await discover(type, { limit, cartoons: type === "cartoons" });
      return json(request, { source: "tmdb", type, count: items.length, items });
    } catch (error) {
      console.error("Catalog request failed:", errorMessage(error));
      return json(request, { error: "Catalog request failed", details: errorMessage(error) }, 502);
    }
  },
};
