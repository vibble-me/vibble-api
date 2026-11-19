import { json, preflight, errorMessage } from "../../lib/http.js";
import { proxyAnimePath, resolveAnimeEpisode } from "../../lib/anime.js";

const ALLOWED_PATHS = [
  /^latest-updated$/,
  /^resolve$/,
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
      if (path === "resolve") {
        const animeId = (url.searchParams.get("animeId") || "").trim();
        const episode = Number.parseInt(url.searchParams.get("episode") || "", 10);
        if (!animeId || !Number.isInteger(episode) || episode < 1) return json(request, { error: "animeId and a positive episode number are required" }, 400);
        return json(request, await resolveAnimeEpisode(animeId, episode));
      }
      const data = await proxyAnimePath(path, url.searchParams);
      return json(request, data);
    } catch (error) {
      console.error("AnimeSuge proxy request failed:", errorMessage(error));
      return json(request, { error: "AnimeSuge request failed", details: errorMessage(error) }, 502);
    }
  },
};
