# Vibble API

Standalone Vercel API for the Vibble Blogger theme. It keeps the TMDB key on the server, uses TMDB for catalogue/search metadata, sends movie and TV playback to Vidlink embeds, and uses the AnimeSuge API for anime-first catalogue and search.

The existing `Vibble Streamer` is a separate project and is not modified or required by this service.

## Routes

- `GET /api/health` — service status.
- `GET /api/catalog?type=anime|movies|tv|cartoons&limit=6` — latest titles. AnimeSuge is tried first for anime; if it is unavailable, TMDB supplies up to six current movies with Vidlink embed links. Movie, TV, and cartoon catalogues use TMDB's Discover endpoints and the configured lookback window.
- `GET /api/search?type=anime|cartoons|movies|tv&query=...` — a single-category search. AnimeSuge is tried first for anime; TMDB is the fallback. Cartoons are animation-genre results.
- `GET /api/player?type=movie|tv&id=...&season=1&episode=1` — returns the Vidlink embed URL for a TMDB ID.
- `GET /api/anime/{documented-route}` — allowlisted proxy for AnimeSuge latest, search, detail, episode-list, server-list, server, and source endpoints. This keeps the client pointed at one API origin while preserving AnimeSuge's query parameters.

Catalogue responses contain `{ source, type, count, items }`. Movie and TV items include `tmdbId`, `poster`, `date`, and `playback.url`; anime items include AnimeSuge identifiers and detail URLs. Search chips are intended to select one category at a time; the Blogspot theme sends only that selected `type`.

## Configure locally

1. Copy `.env.example` to `.env`.
2. Set `TMDB_API_KEY` to the existing TMDB key. Keep `.env` out of Git.
3. Install the Vercel CLI and run `npm run dev` from this directory.
4. Set the same variables in the Vercel project's Environment Variables before production deployment.

`TMDB_LATEST_LOOKBACK_MONTHS` defaults to one month. `TMDB_SORT_BY` controls ordering within that window. The old `TMDB_MAX_MOVIES=25` and `TMDB_MAX_SERIES=10` values are retained as server-side upper limits; the public homepage still caps each request at six items.

## Deploy

Import this standalone `vibble-api` folder as a new Vercel project, set its environment variables, and deploy. Add the resulting production API base to the Blogger theme as `https://<deployment-domain>/api`. Set `CORS_ORIGINS` to the exact Blogspot origin(s) used by the site.

The TMDB secret must be configured in Vercel; it is never included in the theme or API responses. The API uses TMDB IDs for Vidlink movie/TV embeds. Anime playback remains AnimeSuge's separate route flow through `/api/anime/...`.
