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
  const ids = Array.isArray(rawIds) ? rawIds.flatMap((item) => typeof item === "object" && item ? Object.values(item) : [item]).map(String) : typeof rawIds === "string" ? rawIds.split(/[|,]/).map((id) => id.trim()).filter(Boolean) : rawIds ? Object.values(rawIds).map(String) : [];
  if (!ids.length) throw new Error("Episode has no streaming server IDs");
  const serverData = await proxyAnimePath("server/list", new URLSearchParams({ servers: ids.join(",") }));
  const grouped = serverData.servers ?? serverData.groups ?? [];
  const groups = Array.isArray(grouped)
    ? grouped
    : Object.entries(grouped).map(([type, value]) => Array.isArray(value) ? { type, servers: value } : { type, ...value });
  const servers = groups.flatMap((group) => {
    const entries = Array.isArray(group) ? group : (Array.isArray(group?.servers) ? group.servers : []);
    return entries.map((server) => ({ ...server, groupType: String(group?.type || group?.name || server?.type || "") }));
  }).sort((a, b) => {
    const rank = (server) => /dub/i.test(`${server.groupType} ${server.type} ${server.name}`) ? 0
      : /sub/i.test(`${server.groupType} ${server.type} ${server.name}`) ? 1 : 2;
    return rank(a) - rank(b);
  });
  const collectUrls = (value, urls = [], depth = 0) => {
    if (value == null || depth > 8) return urls;
    if (typeof value === "string") {
      const matches = value.match(/https?:\\?\/\\?\/[^\s"'<>\\]+/gi) || [];
      for (const match of matches) urls.push(match.replace(/\\\//g, "").replace(/[),.;]+$/, ""));
    } else if (Array.isArray(value)) value.forEach((entry) => collectUrls(entry, urls, depth + 1));
    else if (typeof value === "object") Object.values(value).forEach((entry) => collectUrls(entry, urls, depth + 1));
    return [...new Set(urls)];
  };
  const asFileId = (value) => {
    if (!value) return "";
    try {
      const parsed = new URL(value);
      return parsed.searchParams.get("id") || parsed.pathname.match(/\/(\d{4,})(?:\/|$)/)?.[1] || "";
    } catch { return ""; }
  };
  const availableServers = servers.filter((item) => item?.linkId || item?.epId);
  const results = await Promise.all(availableServers.map(async (server) => {
    try {
      const resolved = await proxyAnimePath("server", new URLSearchParams({ get: String(server.linkId || server.epId) }));
      let candidates = collectUrls(resolved);
      // AnimeSuge's MegaPlay servers return a page URL first. Resolve that page
      // through the documented sources endpoint before deciding playback failed.
      for (const pageUrl of candidates.filter((candidate) => /megaplay/i.test(candidate))) {
        const sourceParams = new URLSearchParams({ url: pageUrl });
        const fileId = asFileId(pageUrl);
        if (fileId) sourceParams.set("id", fileId);
        try { candidates.push(...collectUrls(await proxyAnimePath("server/sources", sourceParams))); }
        catch { /* Try other AnimeSuge servers if this source is unavailable. */ }
      }
      candidates = [...new Set(candidates)];
      const playable = candidates.filter((candidate) => /\.(m3u8|mp4|m4v|webm)(?:[?#]|$)/i.test(candidate))
        .concat(candidates.filter((candidate) => /(?:\/hls\/|\/stream\/)/i.test(candidate) && !/megaplay/i.test(candidate)));
      return [...new Set(playable)].map((url) => ({
        server: server.name || "AnimeSuge",
        type: server.groupType || server.type || "",
        url,
      }));
    } catch { return []; }
  }));
  const streams = results.flat();
  if (!streams.length) throw new Error("AnimeSuge did not return any playable server links");
  return {
    episode: Number(episode.number ?? episode.episode),
    title: episode.title || `Episode ${episodeNumber}`,
    malId: episode.malId || "",
    server: streams[0].server,
    url: streams[0].url,
    streams,
  };
}
