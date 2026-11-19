import { fetchJson } from "./http.js";
import { createHmac } from "node:crypto";

const DEFAULT_BASE = "https://anisuge-api.vercel.app/api";
const base = () => (process.env.ANISUGE_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
const MEGAPLAY_CDN_TOKEN_SECRET = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";

function signMegaPlayMaster(value, type) {
  try {
    const url = new URL(value);
    if (!/\/master\.m3u8$/i.test(url.pathname) || url.searchParams.has("token")) return value;
    const match = url.pathname.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\/master\.m3u8$/i);
    if (!match) return value;
    const pathKey = `${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
    const payload = `${Math.floor(Date.now() / 1000) + 90}|${pathKey}`;
    const token = `${Buffer.from(payload).toString("base64url")}.${createHmac("sha256", MEGAPLAY_CDN_TOKEN_SECRET).update(payload).digest("base64url")}`;
    url.searchParams.set("t", /sub/i.test(type) ? "sub" : "dub");
    url.searchParams.set("token", token);
    return url.toString();
  } catch { return value; }
}

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
  const availableServers = servers.filter((item) => item?.linkId || item?.epId);
  const results = await Promise.all(availableServers.map(async (server) => {
    try {
      const resolved = await proxyAnimePath("server", new URLSearchParams({ get: String(server.linkId || server.epId) }));
      const serverUrls = collectUrls(resolved);
      const sourcePages = serverUrls.filter((candidate) => /(?:megaplay\.buzz|vidtube\.site)/i.test(candidate) && /\/stream\//i.test(candidate));
      const sourceUrls = [];
      // The URL form lets AnimeSuge derive MegaPlay's actual file ID. The
      // numeric ID in /stream/s-2/{id}/dub is a route ID, not that file ID.
      for (const pageUrl of sourcePages) {
        try { sourceUrls.push(...collectUrls(await proxyAnimePath("server/sources", new URLSearchParams({ url: pageUrl })))); }
        catch { /* Try other AnimeSuge servers if this source is unavailable. */ }
      }
      const mediaSourceUrls = sourceUrls
        .filter((candidate) => !/\/stream\/getSources(?:\?|$)/i.test(candidate))
        .map((candidate) => signMegaPlayMaster(candidate, server.groupType));
      const candidates = [...new Set([
        ...mediaSourceUrls,
        ...serverUrls.filter((candidate) => !sourcePages.includes(candidate)),
      ])];
      const playable = candidates.filter((candidate) => /\.(m3u8|mp4|m4v|webm)(?:[?#]|$)/i.test(candidate))
        .concat(candidates.filter((candidate) => /(?:\/hls\/|\/stream\/)/i.test(candidate) && !sourcePages.includes(candidate)));
      const playerPages = sourcePages.map((pageUrl) => {
        const playerUrl = new URL(pageUrl);
        playerUrl.searchParams.set("autostart", "true");
        return playerUrl.toString();
      });
      return [
        ...playerPages.map((url) => ({ server: server.name || "AnimeSuge", type: server.groupType || server.type || "", url, mode: "embed" })),
        ...[...new Set(playable)].map((url) => ({
        server: server.name || "AnimeSuge",
        type: server.groupType || server.type || "",
        url,
        mode: "stream",
        })),
      ];
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
