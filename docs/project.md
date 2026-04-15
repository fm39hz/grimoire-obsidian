# Grimoire Sync — Obsidian Plugin

## Project overview

Use Obsidian as an editor for books managed by [Grimoire.NET](https://github.com/fm39hz/Grimoire.NET).
Grimoire is the source of truth; Obsidian is the editing surface.

- Pull books from Grimoire → markdown files with frontmatter
- Edit freely in Obsidian (full markdown, footnotes, formatting)
- Push changes back → converted to Grimoire's segment format
- Grimoire handles EPUB 3.3 export, metadata management, and publishing

## Architecture

```
src/
  main.ts              # Plugin lifecycle only
  settings.ts          # Settings interface + settings tab
  api/                 # Grimoire API client
    client.ts          # Base HTTP client (uses Obsidian requestUrl)
    series.ts          # Series endpoints (CRUD + get volumes)
    volumes.ts         # Volume endpoints (CRUD + get chapters)
    chapters.ts        # Chapter endpoints (CRUD + split)
    files.ts           # Asset upload/download
    index.ts           # Unified GrimoireApi facade
  sync/                # Sync orchestration
    sync-manager.ts    # Orchestrates pull/push, tracks state
    pull.ts            # Pull series/volumes/chapters from API
  converter/           # Bidirectional content conversion
    segments-to-markdown.ts    # Grimoire segments → Obsidian markdown
    markdown-to-segments.ts    # Obsidian markdown → Grimoire segments
    footnotes.ts       # Footnote parsing and conversion
  vault/               # Vault file operations
    file-manager.ts    # Read/write files with frontmatter
    frontmatter.ts     # YAML frontmatter creation/parsing
    structure.ts       # Folder hierarchy management
  ui/                  # UI components
  types/               # TypeScript types
    api.ts             # API types (from Grimoire OpenAPI spec)
    sync.ts            # Frontmatter, sync state, local entity types
```

## Content mapping

| Grimoire entity | Vault file                                   | Frontmatter fields                                                                       |
| --------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Series          | `Books/Series Title/Series.md`               | `grimoire_id`, `grimoire_type: series`, `authors`, `artists`, `tags`, `cover_image`      |
| Volume          | `Books/Series Title/Vol N - Title/Volume.md` | `grimoire_id`, `grimoire_type: volume`, `series_id`, `order`, `publication_date`, `isbn` |
| Chapter         | `.../N - Chapter Title.md`                   | `grimoore_id`, `grimoore_type: chapter`, `volume_id`, `order`                            |

## Content conversion

- **Pull**: Grimoire `Segment[]` (TextSegment with TextRun) → markdown with `**bold**`, `*italic*`, `[^footnote]` references + footnote definitions at bottom
- **Push**: Markdown with formatting → `Segment[]` with `TextRun` (isBold, isItalic, footnoteId) + `FootnoteSegment[]`
- Footnotes use standard Obsidian markdown syntax (`[^id]` references, `[^id]: definition` blocks)

## Environment & tooling

- Node.js: LTS (Node 18+)
- **Package manager: npm**
- **Bundler: esbuild**
- Types: `obsidian` type definitions

### Install

```bash
npm install
```

### Dev (watch)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

## Manifest rules (`manifest.json`)

- Never change `id` after release. Treat it as stable API.
- Keep `minAppVersion` accurate when using newer APIs.
- Current plugin ID: `grimoire-sync`

## Commands & settings

- Use `this.addCommand(...)` for user-facing commands.
- Use stable command IDs; avoid renaming once released.
- Persist settings via `this.loadData()` / `this.saveData()`.
- Current commands: `pull-all`, `pull-series`

## Versioning & releases

- Bump `version` in `manifest.json` (SemVer) and update `versions.json`.
- GitHub release tag must match `manifest.json` version exactly (no leading `v`).
- Attach `manifest.json`, `main.js`, `styles.css` as release assets.

## Security, privacy, and compliance

- Only communicate with the user-configured Grimoire API endpoint.
- No telemetry, no hidden network calls.
- Read/write only within the vault. Do not access files outside the vault.
- Register and clean up all listeners using `register*` helpers.

## Coding conventions

- TypeScript with `"strict": true`.
- **Keep `main.ts` minimal**: lifecycle only. Delegate to modules.
- **Split large files**: ~200-300 line limit per file.
- Bundle everything into `main.js` (no unbundled runtime deps).
- Avoid Node/Electron APIs — `isDesktopOnly: false` (mobile compatible).
- Prefer `async/await` over promise chains; handle errors gracefully.
- **Do not commit build artifacts**: Never commit `node_modules/`, `main.js`, or generated files.

## Agent do/don't

**Do**

- Add commands with stable IDs
- Provide defaults and validation in settings
- Keep Grimoire as the source of truth — the plugin syncs to/from it
- Preserve frontmatter `grimoire_id` fields for entity tracking

**Don't**

- Introduce network calls to anything other than the configured Grimoire API
- Store or transmit vault contents outside the sync flow
- Modify the Grimoire API types in `src/types/api.ts` — they are generated from the OpenAPI spec
- Break the bidirectional conversion (markdown ↔ segments) without updating both converters

## Testing

- Manual install: copy `main.js`, `manifest.json`, `styles.css` to `<Vault>/.obsidian/plugins/grimoire-sync/`
- Reload Obsidian and enable in **Settings → Community plugins**

## References

- Grimoire.NET: <https://github.com/fm39hz/Grimoire.NET>
- Obsidian plugin API: <https://docs.obsidian.md>
- Developer policies: <https://docs.obsidian.md/Developer+policies>
- Plugin guidelines: <https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines>
