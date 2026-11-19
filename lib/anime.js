import { fetchJson } from "./http.js";

const DEFAULT_BASE = "https://anisuge-api.vercel.app/api";
const base = () => (process.env.ANISUGE_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");

export function normalizeAnime(item) {
  const title = item.name || item.title || item.englishName || "Untitled";
  return {
    id: String(item.id || item.url || title),
    title,
    name: title,
    poster: item.poster || item.image || item.cover || "",
    url: item.url || "",
    type: "anime",
    subtitle: item.subtitle || "",
    score: item.score || "",
    playback: { provider: "anisuge", mode: "stream", animeId: item.id || "", detailUrl: item.url || "" },
  };
}

export async function latestAnime() {
  const data = await fetchJson(`${base()}/latest-updated`, {}, "AnimeSuge latest catalogue");
  const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : [];
  return items.map(normalizeAnime).slice(0, 6);
}

export async function searchAnime(query) {
  const url = new URL(`${base()}/anime/search`);
  url.searchParams.set("keyword", query);
  const data = await fetchJson(url, {}, "AnimeSuge search");
  const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
  return items.map(normalizeAnime);
}

export async function proxyAnimePath(path, searchParams) {
  const url = new URL(`${base()}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of searchParams) url.searchParams.append(key, value);
  return fetchJson(url, {}, "AnimeSuge API");
}
