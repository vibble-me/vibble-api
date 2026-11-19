import { fetchJson } from "./http.js";

const DEFAULT_BASE = "https://anisuge-api.vercel.app/api";
const base = () => (process.env.ANISUGE_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");

export function normalizeAnime(item) {
  const title = item.name || item.title || item.englishName || "Untitled";
  let animeId = item.id ? String(item.id).trim() : "";
  if (!animeId && item.url) {
    try {
      const parts = new URL(item.url).pathname.split("/").filter(Boolean);
      const animeIndex = parts.lastIndexOf("anime");
      animeId = parts[animeIndex + 1] || parts.at(-1) || "";
    } catch {
      animeId = String(item.url).split("/").filter(Boolean).at(-1) || "";
    }
  }
  return {
    id: animeId || String(item.url || title),
    title,
    name: title,
    poster: item.poster || item.image || item.cover || "",
    url: item.url || "",
    type: "anime",
    subtitle: item.subtitle || "",
    score: item.score || "",
    playback: { provider: "anisuge", mode: "stream", animeId, detailUrl: item.url || "" },
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
  const rawIds = episode.ids ?? episode.dataId ?? episode.id;
  const ids = Array.isArray(rawIds) ? rawIds.map(String) : typeof rawIds === "string" ? rawIds.split(/[|,]/).map((id) => id.trim()).filter(Boolean) : rawIds ? Object.values(rawIds).map(String) : [];
  if (!ids.length) throw new Error("Episode has no streaming server IDs");
  const serverData = await proxyAnimePath("server/list", new URLSearchParams({ servers: ids.join(",") }));
  const grouped = serverData.servers ?? serverData.groups ?? [];
  const groups = Array.isArray(grouped) ? grouped : Object.values(grouped);
  const servers = groups.flatMap((group) => Array.isArray(group) ? group : (Array.isArray(group?.servers) ? group.servers : []));
  const server = servers.find((item) => item.linkId) || servers[0];
  if (!server?.linkId) throw new Error("No playable AnimeSuge server was returned");
  const resolved = await proxyAnimePath("server", new URLSearchParams({ get: String(server.linkId) }));
  const candidates = [];
  const collectUrls = (value, depth = 0) => {
    if (!value || depth > 5) return;
    if (typeof value === "string") { if (/^https?:\/\//i.test(value)) candidates.push(value); return; }
    if (Array.isArray(value)) { value.forEach((entry) => collectUrls(entry, depth + 1)); return; }
    if (typeof value === "object") Object.entries(value).forEach(([key, entry]) => {
      if (/url|file|src|link/i.test(key)) collectUrls(entry, depth + 1);
    });
  };
  collectUrls(resolved);
  const stream = candidates[0];
  if (!stream) throw new Error("AnimeSuge did not return a playable URL");
  return { episode: Number(episode.number ?? episode.episode), title: episode.title || `Episode ${episodeNumber}`, server: server.name || "AnimeSuge", url: stream };
}
