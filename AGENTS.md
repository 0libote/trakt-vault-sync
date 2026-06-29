# AGENTS.md

English-only Obsidian plugin that syncs Trakt data into Markdown notes.

## Commands

- `npm run dev` — esbuild watch mode
- `npm run build` — type-check and production bundle
- `npm run lint` — ESLint
- `npm test` — minimal smoke check

## Conventions

- Use Obsidian's `requestUrl`, not `fetch`.
- Prefix frontmatter keys with `settings.propertyPrefix`.
- Keep template variables unprefixed.
- Key items by `type:traktId`.
- Keep `strictNullChecks` enabled.
- Keep all user-facing copy in `src/strings.ts`.
