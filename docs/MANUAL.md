# Manual

The plugin can sync watchlists, favorites, ratings, watched status, and
detailed watch history. Movies and shows can be enabled independently.

Notes use YAML frontmatter plus editable body templates. Frontmatter keys use
the configured prefix (`trakt_` by default). Template variables use
`{{name}}`; the settings screen contains the editable movie and show defaults.

Optional features include tag notes, Obsidian Bases generation, automatic
sync, Daily Notes entries, incremental history refresh, and TMDB posters.

The plugin only manages its own frontmatter keys and marker-bounded sections.
Keep handwritten Daily Note content outside the Trakt markers.
