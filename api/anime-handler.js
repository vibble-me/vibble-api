import { json, preflight, errorMessage, responseHeaders } from "../lib/http.js";
import { proxyAnimePath, resolveAnimeEpisode } from "../lib/anime.js";

const ALLOWED_PATHS = [
  /^latest-updated$/,
  /^resolve$/,
  /^fallback$/,
  /^stream(?:\.m3u8)?$/,
  /^anime\/search$/,
  /^anime\/detail\/[a-zA-Z0-9_-]+$/,
  /^anime\/list\/[a-zA-Z0-9_-]+$/,
  /^anime\/tooltip\/[0-9]+$/,
  /^server\/list$/,
  /^server$/,
  /^server\/sources$/,
];

function animeSugeUnavailable(error) {
  const message = errorMessage(error);
  return /returned HTTP (?:403|404|410|451)\b|episode was not found|did not return (?:any )?playable|no playable AnimeSuge server|no playable stream URL|servers could not resolve a stream/i.test(message);
}

function vidlinkAnimeUrl(malId, episode, type = "dub") {
  return `https://vidlink.pro/anime/${encodeURIComponent(malId)}/${episode}/${type === "sub" ? "sub" : "dub"}?fallback=true`;
}

function validateStreamUrl(value, baseUrl) {
  const streamUrl = new URL(value, baseUrl);
  const host = streamUrl.hostname.toLowerCase();
  const trustedHost = host === "shiora.top" || host.endsWith(".shiora.top")
    || host === "megaplay.buzz" || host.endsWith(".megaplay.buzz")
    || host === "nexabloom.top" || host.endsWith(".nexabloom.top")
    || host === "imgnex.top" || host.endsWith(".imgnex.top")
    || host === "hiddenvertex.space" || host.endsWith(".hiddenvertex.space")
    || host === "midnightvale.top" || host.endsWith(".midnightvale.top")
    || host === "akirax.buzz" || host.endsWith(".akirax.buzz")
    || host === "vidtube.site" || host.endsWith(".vidtube.site")
    || host === "tiktokcdn.com" || host.endsWith(".tiktokcdn.com");
  if (streamUrl.protocol !== "https:" || !trustedHost) {
    throw new Error(`Unsupported AnimeSuge stream asset: ${streamUrl.protocol}//${host || "(no host)"}`);
  }
  return streamUrl;
}

function streamProxyUrl(request, streamUrl) {
  const proxy = new URL("/api/anime/stream.m3u8", request.url);
  proxy.searchParams.set("url", streamUrl);
  return proxy.toString();
}

function rewriteHlsPlaylist(playlist, request, baseUrl) {
  const output = [];
  for (const line of playlist.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) { output.push(line); continue; }
    if (trimmed.startsWith("#")) {
      output.push(line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${streamProxyUrl(request, validateStreamUrl(uri, baseUrl).toString())}"`));
      continue;
    }

    const asset = validateStreamUrl(trimmed, baseUrl);
    output.push(streamProxyUrl(request, asset.toString()));
  }
  return output.join("\n");
}

async function proxyAnimeStream(request, rawUrl) {
  let source;
  try { source = validateStreamUrl(rawUrl); }
  catch (error) { return json(request, { error: errorMessage(error) }, 400); }

  const headers = new Headers({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Referer": "https://megaplay.buzz/",
    "Origin": "https://megaplay.buzz",
  });
  const range = request.headers.get("range");
  if (range) headers.set("Range", range);

  let upstream;
  let currentUrl = source;
  try {
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      upstream = await fetch(currentUrl, { headers, redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location || redirectCount === 3) break;
      currentUrl = validateStreamUrl(location, currentUrl);
    }
  } catch (error) {
    console.error("AnimeSuge stream proxy fetch failed:", errorMessage(error));
    return json(request, { error: "Could not reach the AnimeSuge stream host", details: errorMessage(error) }, 502);
  }
  if (!upstream.ok) return json(request, { error: "AnimeSuge stream host denied the request", details: `Upstream returned HTTP ${upstream.status}` }, upstream.status === 403 ? 403 : 502);

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  if (/^image\//i.test(contentType)) {
    return json(request, { error: "AnimeSuge server returned an image instead of a media segment", details: contentType }, 415);
  }
  if (/mpegurl|\.m3u8(?:$|\?)/i.test(contentType) || /\.m3u8$/i.test(currentUrl.pathname)) {
    const playlist = rewriteHlsPlaylist(await upstream.text(), request, currentUrl);
    return new Response(playlist, {
      status: upstream.status,
      headers: responseHeaders(request, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" }),
    });
  }

  const responseHeadersOut = responseHeaders(request, { "Cache-Control": "no-store" });
  for (const name of ["content-type", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeadersOut[name] = value;
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeadersOut });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return preflight(request);
    if (request.method !== "GET") return json(request, { error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    // Vercel's flat-function rewrite places the original route here.
    const path = (url.searchParams.get("path") || "").replace(/^\/+/, "");
    const searchParams = new URLSearchParams(url.searchParams);
    searchParams.delete("path");
    if (!ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
      return json(request, { error: "Unsupported AnimeSuge route", path }, 404);
    }
    try {
      if (path === "fallback") {
        const query = (searchParams.get("query") || "").trim();
        const episode = Math.max(1, Number.parseInt(searchParams.get("episode") || "1", 10) || 1);
        const malId = (searchParams.get("malId") || "").trim();
        const animeType = searchParams.get("type") === "sub" ? "sub" : "dub";
        if (!/^\d+$/.test(malId)) return json(request, { error: "A MyAnimeList ID is required for the Vidlink Anime backup" }, 400);
        const playerUrl = vidlinkAnimeUrl(malId, episode, animeType);
        return json(request, { title: query, source: "vidlink-anime-fallback", playback: { provider: "vidlink", mode: "embed", url: playerUrl } });
      }
      if (path === "stream" || path === "stream.m3u8") {
        const streamUrl = searchParams.get("url");
        if (!streamUrl) return json(request, { error: "url is required" }, 400);
        return await proxyAnimeStream(request, streamUrl);
      }
      if (path === "resolve") {
        const animeId = (searchParams.get("animeId") || "").trim();
        const episode = Number.parseInt(searchParams.get("episode") || "", 10);
        if (!animeId || !Number.isInteger(episode) || episode < 1) return json(request, { error: "animeId and a positive episode number are required" }, 400);
        try {
          const resolved = await resolveAnimeEpisode(animeId, episode);
          const streams = (resolved.streams || [{ server: resolved.server, type: "", url: resolved.url }]).map((stream) => ({
            ...stream,
            url: streamProxyUrl(request, stream.url),
          }));
          return json(request, { ...resolved, url: streams[0]?.url || "", streams, provider: "anisuge" });
        }
        catch (error) {
          const query = (searchParams.get("title") || "").trim();
          const malId = (searchParams.get("malId") || "").trim();
          const animeType = searchParams.get("type") === "sub" ? "sub" : "dub";
          if (query && /^\d+$/.test(malId) && animeSugeUnavailable(error)) {
            return json(request, { episode, provider: "vidlink", fallback: true, title: query, url: vidlinkAnimeUrl(malId, episode, animeType) });
          }
          throw error;
        }
      }
      return json(request, await proxyAnimePath(path, searchParams));
    } catch (error) {
      console.error("AnimeSuge proxy request failed:", errorMessage(error));
      return json(request, { error: "AnimeSuge request failed", details: errorMessage(error) }, 502);
    }
  },
};
