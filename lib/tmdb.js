import { fetchJson } from "./http.js";

const API = "https://api.themoviedb.org/3";
export const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
export const ANIMATION_GENRE_ID = 16;

function requiredKey() {
  const key = process.env.TMDB_API_KEY?.trim();
  if (!key) throw new Error("TMDB_API_KEY is not configured on the server");
  return key;
}

function latestRange() {
  const end = new Date();
  const start = new Date(end);
  const months = Number.parseInt(process.env.TMDB_LATEST_LOOKBACK_MONTHS || "1", 10);
  start.setMonth(start.getMonth() - (Number.isFinite(months) && months > 0 ? months : 1));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function config() {
  return {
    api_key: requiredKey(),
    language: process.env.TMDB_DISCOVER_LANGUAGE || "en-US",
    include_adult: process.env.TMDB_INCLUDE_ADULT || "false",
    page: "1",
  };
}

async function tmdb(path, params, label) {
  const url = new URL(`${API}${path}`);
  Object.entries({ ...config(), ...params }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return fetchJson(url, {}, label);
}

export async function getTvSeason(id, season) {
  const [show, data] = await Promise.all([
    tmdb(`/tv/${encodeURIComponent(id)}`, {}, "TMDB TV details"),
    tmdb(`/tv/${encodeURIComponent(id)}/season/${encodeURIComponent(season)}`, {}, "TMDB season details"),
  ]);
  return {
    id: String(show.id),
    title: show.name || "TV Show",
    seasons: (show.seasons || []).filter((item) => item.season_number > 0).map((item) => ({
      number: item.season_number,
      name: item.name,
      episodeCount: item.episode_count,
    })),
    episodes: (data.episodes || []).map((item) => ({
      number: item.episode_number,
      name: item.name || `Episode ${item.episode_number}`,
    })),
  };
}

export function normalizeTmdb(item, mediaType) {
  const type = mediaType || item.media_type || (item.title ? "movie" : "tv");
  const id = String(item.id);
  const title = item.title || item.name || item.original_title || item.original_name || "Untitled";
  const date = item.release_date || item.first_air_date || "";
  const playerUrl = type === "movie"
    ? `https://vidlink.pro/movie/${encodeURIComponent(id)}`
    : `https://vidlink.pro/tv/${encodeURIComponent(id)}/1/1`;
  return {
    id,
    tmdbId: id,
    type,
    title,
    name: title,
    poster: item.poster_path ? `${TMDB_IMAGE}${item.poster_path}` : "",
    date,
    year: date.slice(0, 4),
    overview: item.overview || "",
    popularity: item.popularity ?? 0,
    genreIds: item.genre_ids || [],
    originalLanguage: item.original_language || "",
    playback: { provider: "vidlink", mode: "embed", url: playerUrl },
  };
}

export async function discover(type, { cartoons = false, limit = 6 } = {}) {
  const { from, to } = latestRange();
  const common = {
    sort_by: process.env.TMDB_SORT_BY || "popularity.desc",
    ...(cartoons ? { with_genres: String(ANIMATION_GENRE_ID) } : {}),
  };
  const configuredMax = type === "tv"
    ? Number.parseInt(process.env.TMDB_MAX_SERIES || "10", 10)
    : Number.parseInt(process.env.TMDB_MAX_MOVIES || "25", 10);
  const requested = Math.max(1, Math.min(6, Number.isFinite(configuredMax) ? configuredMax : 6, Number.parseInt(limit, 10) || 6));

  if (type === "movies" || type === "cartoons") {
    const movieParams = {
      ...common,
      region: process.env.TMDB_REGION || "US",
      "primary_release_date.gte": from,
      "primary_release_date.lte": to,
    };
    if (type === "cartoons") {
      const tvParams = {
        ...common,
        "first_air_date.gte": from,
        "first_air_date.lte": to,
      };
      const [movies, shows] = await Promise.all([
        tmdb("/discover/movie", movieParams, "TMDB movie discovery"),
        tmdb("/discover/tv", tvParams, "TMDB TV discovery"),
      ]);
      return [...(movies.results || []).map((item) => normalizeTmdb(item, "movie")),
        ...(shows.results || []).map((item) => normalizeTmdb(item, "tv"))]
        .filter((item) => item.genreIds.includes(ANIMATION_GENRE_ID))
        .sort((a, b) => b.date.localeCompare(a.date) || b.popularity - a.popularity)
        .slice(0, requested);
    }
    const data = await tmdb("/discover/movie", movieParams, "TMDB movie discovery");
    return (data.results || []).slice(0, requested).map((item) => normalizeTmdb(item, "movie"));
  }

  if (type === "tv") {
    const data = await tmdb("/discover/tv", {
      ...common,
      "first_air_date.gte": from,
      "first_air_date.lte": to,
    }, "TMDB TV discovery");
    return (data.results || []).slice(0, requested).map((item) => normalizeTmdb(item, "tv"));
  }

  if (type === "anime") {
    const data = await tmdb("/discover/tv", {
      ...common,
      with_genres: String(ANIMATION_GENRE_ID),
      with_original_language: "ja",
      "first_air_date.gte": from,
      "first_air_date.lte": to,
    }, "TMDB anime fallback");
    return (data.results || []).slice(0, requested).map((item) => normalizeTmdb(item, "tv"));
  }
  throw new Error("Unsupported catalogue type");
}

export async function searchTmdb(type, query) {
  const paths = type === "movies" ? ["movie"] : type === "tv" ? ["tv"] : ["multi"];
  const results = await Promise.all(paths.map(async (path) => {
    const data = await tmdb(`/search/${path}`, { query, page: "1" }, `TMDB ${path} search`);
    return (data.results || [])
      .filter((item) => item.media_type !== "person")
      .map((item) => normalizeTmdb(item, item.media_type || path));
  }));
  let items = results.flat();
  if (type === "cartoons") items = items.filter((item) => item.genreIds.includes(ANIMATION_GENRE_ID));
  if (type === "anime") items = items.filter((item) => item.genreIds.includes(ANIMATION_GENRE_ID) && item.originalLanguage === "ja");
  return items.sort((a, b) => b.popularity - a.popularity);
}
