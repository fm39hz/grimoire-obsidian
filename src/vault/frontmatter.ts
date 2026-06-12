import { parseYaml, stringifyYaml } from "obsidian";
import type {
	Frontmatter,
	SeriesFrontmatter,
	VolumeFrontmatter,
	ChapterFrontmatter,
	GrimoireEntityType,
	VolumeResponse,
	ChapterListResponse,
} from "../types";
import { FRONTMATTER_KEYS, sanitizeFileName } from "../utils";

/**
 * Parse YAML frontmatter from markdown content
 * Returns the frontmatter object and the content without frontmatter
 */
export function parseFrontmatter(content: string): {
	frontmatter: Record<string, unknown> | null;
	content: string;
} {
	const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?/;
	const match = content.match(frontmatterRegex);

	if (!match || !match[1]) {
		return { frontmatter: null, content };
	}

	const yamlContent = match[1];
	const remainingContent = content.slice(match[0].length);

	try {
		const frontmatter = parseYaml(yamlContent) as Record<string, unknown>;
		return { frontmatter, content: remainingContent };
	} catch {
		return { frontmatter: null, content };
	}
}

/**
 * Convert frontmatter object to YAML string
 */
export function stringifyFrontmatter(frontmatter: Record<string, unknown>): string {
	try {
		const yaml = stringifyYaml(frontmatter);
		return `---\n${yaml.trim()}\n---`;
	} catch {
		return "---\n---";
	}
}

/**
 * Create a complete markdown file with frontmatter
 */
export function createMarkdownWithFrontmatter(
	frontmatter: Record<string, unknown>,
	content: string
): string {
	const yamlHeader = stringifyFrontmatter(frontmatter);
	return `${yamlHeader}\n\n${content}`;
}

/**
 * Check if content has Grimoire frontmatter
 */
export function hasGrimoireFrontmatter(content: string): boolean {
	const { frontmatter } = parseFrontmatter(content);
	return frontmatter !== null && FRONTMATTER_KEYS.ID in frontmatter && FRONTMATTER_KEYS.TYPE in frontmatter;
}

/**
 * Extract Grimoire entity type from frontmatter
 */
export function getEntityType(content: string): GrimoireEntityType | null {
	const { frontmatter } = parseFrontmatter(content);
	if (!frontmatter) return null;

	const type = frontmatter[FRONTMATTER_KEYS.TYPE];
	if (type === "series" || type === "volume" || type === "chapter") {
		return type;
	}
	return null;
}

/**
 * Map raw frontmatter record to SeriesFrontmatter
 */
export function mapSeriesFrontmatter(frontmatter: Record<string, unknown> | null | undefined): SeriesFrontmatter | null {
	if (!frontmatter || frontmatter[FRONTMATTER_KEYS.TYPE] !== "series") {
		return null;
	}

	return {
		grimoire_id: String(frontmatter[FRONTMATTER_KEYS.ID] || ""),
		grimoire_type: "series",
		title: String(frontmatter[FRONTMATTER_KEYS.TITLE] || ""),
		last_synced: String(frontmatter[FRONTMATTER_KEYS.LAST_SYNCED] || ""),
		authors: (frontmatter[FRONTMATTER_KEYS.AUTHORS] as string[]) || undefined,
		artists: (frontmatter[FRONTMATTER_KEYS.ARTISTS] as string[]) || undefined,
		tags: (frontmatter[FRONTMATTER_KEYS.TAGS] as string[]) || undefined,
		cover_image: (frontmatter[FRONTMATTER_KEYS.COVER_IMAGE] as string) || undefined,
	};
}

/**
 * Map raw frontmatter record to VolumeFrontmatter
 */
export function mapVolumeFrontmatter(frontmatter: Record<string, unknown> | null | undefined): VolumeFrontmatter | null {
	if (!frontmatter || frontmatter[FRONTMATTER_KEYS.TYPE] !== "volume") {
		return null;
	}

	return {
		grimoire_id: String(frontmatter[FRONTMATTER_KEYS.ID] || ""),
		grimoire_type: "volume",
		title: String(frontmatter[FRONTMATTER_KEYS.TITLE] || ""),
		last_synced: String(frontmatter[FRONTMATTER_KEYS.LAST_SYNCED] || ""),
		series_id: String(frontmatter[FRONTMATTER_KEYS.SERIES_ID] || ""),
		order: Number(frontmatter[FRONTMATTER_KEYS.ORDER]) || 0,
		publication_date: (frontmatter[FRONTMATTER_KEYS.PUBLICATION_DATE] as string) || undefined,
		isbn: (frontmatter[FRONTMATTER_KEYS.ISBN] as string) || undefined,
		cover_image: (frontmatter[FRONTMATTER_KEYS.COVER_IMAGE] as string) || undefined,
	};
}

/**
 * Map raw frontmatter record to ChapterFrontmatter
 */
export function mapChapterFrontmatter(frontmatter: Record<string, unknown> | null | undefined): ChapterFrontmatter | null {
	if (!frontmatter || frontmatter[FRONTMATTER_KEYS.TYPE] !== "chapter") {
		return null;
	}

	return {
		grimoire_id: String(frontmatter[FRONTMATTER_KEYS.ID] || ""),
		grimoire_type: "chapter",
		title: String(frontmatter[FRONTMATTER_KEYS.TITLE] || ""),
		last_synced: String(frontmatter[FRONTMATTER_KEYS.LAST_SYNCED] || ""),
		volume_id: String(frontmatter[FRONTMATTER_KEYS.VOLUME_ID] || ""),
		order: Number(frontmatter[FRONTMATTER_KEYS.ORDER]) || 0,
	};
}

/**
 * Parse frontmatter as SeriesFrontmatter
 */
export function parseSeriesFrontmatter(content: string): SeriesFrontmatter | null {
	const { frontmatter } = parseFrontmatter(content);
	return mapSeriesFrontmatter(frontmatter);
}

/**
 * Parse frontmatter as VolumeFrontmatter
 */
export function parseVolumeFrontmatter(content: string): VolumeFrontmatter | null {
	const { frontmatter } = parseFrontmatter(content);
	return mapVolumeFrontmatter(frontmatter);
}

/**
 * Parse frontmatter as ChapterFrontmatter
 */
export function parseChapterFrontmatter(content: string): ChapterFrontmatter | null {
	const { frontmatter } = parseFrontmatter(content);
	return mapChapterFrontmatter(frontmatter);
}

function formatLink(
	path: string,
	display: string,
	style: "WikiLinks" | "MarkdownLinks"
): string {
	if (style === "WikiLinks") {
		const cleanPath = path.endsWith(".md") ? path.slice(0, -3) : path;
		return `[[${cleanPath}|${display}]]`;
	} else {
		const cleanPath = path.endsWith(".md") ? path : `${path}.md`;
		return `[${display}](${cleanPath})`;
	}
}

/**
 * Create SeriesFrontmatter object
 */
export function createSeriesFrontmatter(
	id: string,
	title: string,
	options?: {
		authors?: string[];
		artists?: string[];
		tags?: string[];
		coverImage?: string;
		volumes?: VolumeResponse[];
		linkStyle?: "WikiLinks" | "MarkdownLinks";
		includeMetadataFiles?: boolean;
		includeFrontmatter?: boolean;
	}
): Record<string, unknown> {
	const includeFM = options?.includeFrontmatter ?? true;
	const linkStyle = options?.linkStyle ?? "WikiLinks";
	const includeMeta = options?.includeMetadataFiles ?? true;

	const fm: Record<string, unknown> = {};

	if (includeFM) {
		fm[FRONTMATTER_KEYS.ID] = id;
		fm[FRONTMATTER_KEYS.TYPE] = "series";
	}

	fm[FRONTMATTER_KEYS.TITLE] = title;

	if (includeFM) {
		fm[FRONTMATTER_KEYS.LAST_SYNCED] = new Date().toISOString();
	}

	if (options?.authors) fm[FRONTMATTER_KEYS.AUTHORS] = options.authors;
	if (options?.artists) fm[FRONTMATTER_KEYS.ARTISTS] = options.artists;
	if (options?.tags) fm[FRONTMATTER_KEYS.TAGS] = options.tags;
	if (options?.coverImage) fm[FRONTMATTER_KEYS.COVER_IMAGE] = options.coverImage;

	if (includeFM && includeMeta && options?.volumes && options.volumes.length > 0) {
		const links = options.volumes
			.filter(vol => vol.title)
			.map(vol => {
				const folderName = sanitizeFileName(vol.title!);
				const path = `${folderName}/_volume.md`;
				return formatLink(path, vol.title!, linkStyle);
			});
		fm["volumes"] = links;
	}

	return fm;
}

/**
 * Create VolumeFrontmatter object
 */
export function createVolumeFrontmatter(
	id: string,
	seriesId: string,
	title: string,
	order: number,
	options?: {
		publicationDate?: string;
		isbn?: string;
		coverImage?: string;
		seriesTitle?: string;
		chapters?: ChapterListResponse[];
		linkStyle?: "WikiLinks" | "MarkdownLinks";
		includeMetadataFiles?: boolean;
		includeFrontmatter?: boolean;
	}
): Record<string, unknown> {
	const includeFM = options?.includeFrontmatter ?? true;
	const linkStyle = options?.linkStyle ?? "WikiLinks";
	const includeMeta = options?.includeMetadataFiles ?? true;

	const fm: Record<string, unknown> = {};

	if (includeFM) {
		fm[FRONTMATTER_KEYS.ID] = id;
		fm[FRONTMATTER_KEYS.TYPE] = "volume";
		fm[FRONTMATTER_KEYS.SERIES_ID] = seriesId;
	}

	fm[FRONTMATTER_KEYS.TITLE] = title;
	fm[FRONTMATTER_KEYS.ORDER] = order;

	if (includeFM) {
		fm[FRONTMATTER_KEYS.LAST_SYNCED] = new Date().toISOString();
	}

	if (options?.publicationDate) fm[FRONTMATTER_KEYS.PUBLICATION_DATE] = options.publicationDate;
	if (options?.isbn) fm[FRONTMATTER_KEYS.ISBN] = options.isbn;
	if (options?.coverImage) fm[FRONTMATTER_KEYS.COVER_IMAGE] = options.coverImage;

	if (includeFM && includeMeta && options?.seriesTitle) {
		const path = "../_series.md";
		fm["series"] = formatLink(path, options.seriesTitle, linkStyle);
	}

	if (includeFM && options?.chapters && options.chapters.length > 0) {
		const links = options.chapters
			.filter(ch => ch.title)
			.map(ch => {
				const fileName = sanitizeFileName(ch.title!) + ".md";
				return formatLink(fileName, ch.title!, linkStyle);
			});
		fm["chapters"] = links;
	}

	return fm;
}

/**
 * Create ChapterFrontmatter object
 */
export function createChapterFrontmatter(
	id: string,
	volumeId: string,
	title: string,
	order: number,
	options?: {
		volumeTitle?: string;
		linkStyle?: "WikiLinks" | "MarkdownLinks";
		includeMetadataFiles?: boolean;
		includeFrontmatter?: boolean;
	}
): Record<string, unknown> {
	const includeFM = options?.includeFrontmatter ?? true;
	const linkStyle = options?.linkStyle ?? "WikiLinks";
	const includeMeta = options?.includeMetadataFiles ?? true;

	const fm: Record<string, unknown> = {};

	if (includeFM) {
		fm[FRONTMATTER_KEYS.ID] = id;
		fm[FRONTMATTER_KEYS.TYPE] = "chapter";
		fm[FRONTMATTER_KEYS.VOLUME_ID] = volumeId;
	}

	fm[FRONTMATTER_KEYS.TITLE] = title;
	fm[FRONTMATTER_KEYS.ORDER] = order;

	if (includeFM) {
		fm[FRONTMATTER_KEYS.LAST_SYNCED] = new Date().toISOString();
	}

	if (includeFM && includeMeta && options?.volumeTitle) {
		const path = "_volume.md";
		fm["volume"] = formatLink(path, options.volumeTitle, linkStyle);
	}

	return fm;
}
