/**
 * Frontmatter parsing and writing utilities
 */

import type {
	Frontmatter,
	SeriesFrontmatter,
	VolumeFrontmatter,
	ChapterFrontmatter,
	GrimoireEntityType,
} from "../types";
import { FRONTMATTER_KEYS } from "../utils";

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
		const frontmatter = parseYaml(yamlContent);
		return { frontmatter, content: remainingContent };
	} catch {
		return { frontmatter: null, content };
	}
}

/**
 * Simple YAML parser for frontmatter
 * Handles basic types: strings, numbers, booleans, arrays
 */
function parseYaml(yaml: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = yaml.split("\n");
	let currentKey: string | null = null;
	let currentArray: string[] | null = null;

	for (const line of lines) {
		// Skip empty lines
		if (!line.trim()) continue;

		// Check for array item
		if (line.match(/^\s+-\s+/) && currentKey && currentArray) {
			const value = line.replace(/^\s+-\s+/, "").trim();
			currentArray.push(unquote(value));
			continue;
		}

		// Check for key-value pair
		const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
		if (kvMatch && kvMatch[1]) {
			// Save previous array if any
			if (currentKey && currentArray) {
				result[currentKey] = currentArray;
				currentArray = null;
			}

			currentKey = kvMatch[1];
			const value = kvMatch[2]?.trim() || "";

			if (value === "" || value === "[]") {
				// Could be start of array or empty value
				currentArray = [];
			} else if (value.startsWith("[") && value.endsWith("]")) {
				// Inline array
				const arrayContent = value.slice(1, -1);
				result[currentKey] = arrayContent
					.split(",")
					.map((s) => unquote(s.trim()))
					.filter(Boolean);
				currentKey = null;
			} else {
				result[currentKey] = parseValue(value);
				currentKey = null;
			}
		}
	}

	// Save final array if any
	if (currentKey && currentArray) {
		result[currentKey] = currentArray;
	}

	return result;
}

/**
 * Parse a YAML value
 */
function parseValue(value: string): unknown {
	// Boolean
	if (value === "true") return true;
	if (value === "false") return false;

	// Null
	if (value === "null" || value === "~") return null;

	// Number
	if (/^-?\d+$/.test(value)) return parseInt(value, 10);
	if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

	// String (remove quotes if present)
	return unquote(value);
}

/**
 * Remove quotes from a string value
 */
function unquote(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

/**
 * Convert frontmatter object to YAML string
 */
export function stringifyFrontmatter(frontmatter: Record<string, unknown>): string {
	const lines: string[] = ["---"];

	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined || value === null) continue;

		if (Array.isArray(value)) {
			if (value.length === 0) {
				lines.push(`${key}: []`);
			} else {
				lines.push(`${key}:`);
				for (const item of value) {
					lines.push(`  - ${quoteIfNeeded(String(item))}`);
				}
			}
		} else if (typeof value === "string") {
			lines.push(`${key}: ${quoteIfNeeded(value)}`);
		} else if (typeof value === "number" || typeof value === "boolean") {
			lines.push(`${key}: ${value}`);
		}
	}

	lines.push("---");
	return lines.join("\n");
}

/**
 * Quote a string if it contains special characters
 */
function quoteIfNeeded(value: string): string {
	if (/[:#\[\]{}|>&*!,]/.test(value) || value.includes("\n")) {
		return `"${value.replace(/"/g, '\\"')}"`;
	}
	return value;
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
 * Parse frontmatter as SeriesFrontmatter
 */
export function parseSeriesFrontmatter(content: string): SeriesFrontmatter | null {
	const { frontmatter } = parseFrontmatter(content);
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
 * Parse frontmatter as VolumeFrontmatter
 */
export function parseVolumeFrontmatter(content: string): VolumeFrontmatter | null {
	const { frontmatter } = parseFrontmatter(content);
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
 * Parse frontmatter as ChapterFrontmatter
 */
export function parseChapterFrontmatter(content: string): ChapterFrontmatter | null {
	const { frontmatter } = parseFrontmatter(content);
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
	}
): Record<string, unknown> {
	return {
		[FRONTMATTER_KEYS.ID]: id,
		[FRONTMATTER_KEYS.TYPE]: "series",
		[FRONTMATTER_KEYS.TITLE]: title,
		[FRONTMATTER_KEYS.LAST_SYNCED]: new Date().toISOString(),
		...(options?.authors && { [FRONTMATTER_KEYS.AUTHORS]: options.authors }),
		...(options?.artists && { [FRONTMATTER_KEYS.ARTISTS]: options.artists }),
		...(options?.tags && { [FRONTMATTER_KEYS.TAGS]: options.tags }),
		...(options?.coverImage && { [FRONTMATTER_KEYS.COVER_IMAGE]: options.coverImage }),
	};
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
	}
): Record<string, unknown> {
	return {
		[FRONTMATTER_KEYS.ID]: id,
		[FRONTMATTER_KEYS.TYPE]: "volume",
		[FRONTMATTER_KEYS.SERIES_ID]: seriesId,
		[FRONTMATTER_KEYS.TITLE]: title,
		[FRONTMATTER_KEYS.ORDER]: order,
		[FRONTMATTER_KEYS.LAST_SYNCED]: new Date().toISOString(),
		...(options?.publicationDate && { [FRONTMATTER_KEYS.PUBLICATION_DATE]: options.publicationDate }),
		...(options?.isbn && { [FRONTMATTER_KEYS.ISBN]: options.isbn }),
		...(options?.coverImage && { [FRONTMATTER_KEYS.COVER_IMAGE]: options.coverImage }),
	};
}

/**
 * Create ChapterFrontmatter object
 */
export function createChapterFrontmatter(
	id: string,
	volumeId: string,
	title: string,
	order: number
): Record<string, unknown> {
	return {
		[FRONTMATTER_KEYS.ID]: id,
		[FRONTMATTER_KEYS.TYPE]: "chapter",
		[FRONTMATTER_KEYS.VOLUME_ID]: volumeId,
		[FRONTMATTER_KEYS.TITLE]: title,
		[FRONTMATTER_KEYS.ORDER]: order,
		[FRONTMATTER_KEYS.LAST_SYNCED]: new Date().toISOString(),
	};
}
