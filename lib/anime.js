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

export async function resolveAnimeEpisode(animeId, episodeNumber) {
  const list = await proxyAnimePath(`anime/list/${encodeURIComponent(animeId)}`, new URLSearchParams());
  const episodes = Array.isArray(list.episodes) ? list.episodes : [];
  const episode = episodes.find((item) => Number(item.number ?? item.episode) === Number(episodeNumber));
  if (!episode) throw new Error("Episode was not found");
  const ids = Array.isArray(episode.ids) ? episode.ids : [episode.ids || episode.dataId || episode.id].filter(Boolean);
  if (!ids.length) throw new Error("Episode has no streaming server IDs");
  const serverData = await proxyAnimePath("server/list", new URLSearchParams({ servers: ids.join(",") }));
  const groups = Array.isArray(serverData.servers) ? serverData.servers : Object.values(serverData.servers || {});
  const servers = groups.flatMap((group) => Array.isArray(group) ? group : (group.servers || []));
  const server = servers.find((item) => item.linkId) || servers[0];
  if (!server?.linkId) throw new Error("No playable AnimeSuge server was returned");
  const resolved = await proxyAnimePath("server", new URLSearchParams({ get: String(server.linkId) }));
  const candidates = [resolved.url, resolved.result?.url, resolved.result?.file, resolved.result?.src].filter((value) => typeof value === "string" && /^https?:\/\//i.test(value));
  const stream = candidates[0];
  if (!stream) throw new Error("AnimeSuge did not return a playable URL");
  return { episode: Number(episode.number ?? episode.episode), title: episode.title || `Episode ${episodeNumber}`, server: server.name || "AnimeSuge", url: stream };
}
