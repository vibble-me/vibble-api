import { json, preflight, errorMessage } from "../../lib/http.js";
import { proxyAnimePath, resolveAnimeEpisode } from "../../lib/anime.js";
import { searchTmdb } from "../../lib/tmdb.js";

const ALLOWED_PATHS = [
  /^latest-updated$/,
  /^resolve$/,
  /^fallback$/,
  /^anime\/search$/,
  /^anime\/detail\/[a-zA-Z0-9_-]+$/,
  /^anime\/list\/[a-zA-Z0-9_-]+$/,
  /^anime\/tooltip\/[0-9]+$/,
  /^server\/list$/,
  /^server$/,
  /^server\/sources$/,
];

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return preflight(request);
    if (request.method !== "GET") return json(request, { error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/anime\/?/, "");
    if (!ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
      return json(request, { error: "Unsupported AnimeSuge route" }, 404);
    }
    try {
      if (path === "fallback") {
        const query = (url.searchParams.get("query") || "").trim();
        if (!query) return json(request, { error: "query is required" }, 400);
        const items = await searchTmdb("anime", query);
        const item = items[0];
        if (!item) return json(request, { error: "No backup match for this anime" }, 404);
        const episode = Math.max(1, Number.parseInt(url.searchParams.get("episode") || "1", 10) || 1);
        const playerUrl = item.type === "tv"
          ? `https://vidlink.pro/tv/${encodeURIComponent(item.tmdbId)}/1/${episode}`
          : item.playback.url;
        return json(request, { ...item, source: "tmdb-vidlink-fallback", playback: { provider: "vidlink", mode: "embed", url: playerUrl } });
      }
      if (path === "resolve") {
        const animeId = (url.searchParams.get("animeId") || "").trim();
        const episode = Number.parseInt(url.searchParams.get("episode") || "", 10);
        if (!animeId || !Number.isInteger(episode) || episode < 1) return json(request, { error: "animeId and a positive episode number are required" }, 400);
        try { return json(request, { ...(await resolveAnimeEpisode(animeId, episode)), provider: "anisuge" }); }
        catch (error) {
          const query = (url.searchParams.get("title") || "").trim();
          if (query) {
            const matches = await searchTmdb("anime", query);
            const item = matches[0];
            if (item) {
              const playerUrl = item.type === "tv"
                ? `https://vidlink.pro/tv/${encodeURIComponent(item.tmdbId)}/1/${episode}`
                : item.playback.url;
              return json(request, { episode, provider: "vidlink", fallback: true, title: item.title, url: playerUrl });
            }
          }
          throw error;
        }
      }
      const data = await proxyAnimePath(path, url.searchParams);
      return json(request, data);
    } catch (error) {
      console.error("AnimeSuge proxy request failed:", errorMessage(error));
      return json(request, { error: "AnimeSuge request failed", details: errorMessage(error) }, 502);
    }
  },
};
