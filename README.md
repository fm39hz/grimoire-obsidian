# Grimoire Sync

Use [Obsidian](https://obsidian.md) as an editor for books managed by [Grimoire.NET](https://github.com/fm39hz/Grimoire.NET). Grimoire stays the source of truth; Obsidian is the editing surface.

## How It Works

1. **Pull** — Fetch books from your Grimoire backend into your vault as markdown files. Content, formatting (bold/italic), and footnotes are converted to native markdown. Each file carries frontmatter with Grimoire IDs for tracking.
2. **Edit** — Write and edit freely in Obsidian with its full markdown editing experience.
3. **Push** — Send changes back. Markdown is converted to Grimoire's segment format and synced to the backend.
4. **Publish** — Grimoire handles EPUB 3.3 export, metadata management, and anthology packaging.

## Content Mapping

| Grimoire | Obsidian Vault                                               |
| -------- | ------------------------------------------------------------ |
| Series   | `Books/Series Title/Series.md` (metadata + frontmatter)      |
| Volume   | `Books/Series Title/Vol 1 - Volume Title/Volume.md`          |
| Chapter  | `.../01 - Chapter Title.md` (markdown content + frontmatter) |

## Setup

1. Build: `npm install && npm run build`
2. Copy `main.js`, `manifest.json`, `styles.css` to `<Vault>/.obsidian/plugins/grimoire-sync/`
3. Reload Obsidian, enable the plugin
4. In **Settings → Grimoire Sync**, set your Grimoire API base URL (e.g. `http://localhost:5062`)
5. Click **Test** to verify connectivity

## Commands

| Command                              | Description                                            |
| ------------------------------------ | ------------------------------------------------------ |
| Pull all series from Grimoire        | Fetch every series and create the full vault structure |
| Pull a specific series from Grimoire | Select a series from a modal and pull it               |

## Development

```bash
npm run dev    # watch mode
npm run build  # production build
npm run lint   # lint check
```
