# Developer guide

Install dependencies with `npm ci`. Use `npm run dev` while developing and
run `npm run build`, `npm run lint`, and `npm test` before shipping.

The entry point is `src/main.ts`. `SyncEngine` loads Trakt data, enriches it
with TMDB posters, and renders notes through `note-renderer.ts`. Settings live
in `settings.ts`; API clients are `trakt-api.ts` and `tmdb-api.ts`.

`main.js` is generated and should not be committed.
