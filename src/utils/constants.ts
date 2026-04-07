/**
 * Plugin constants
 */

/** File name for series metadata */
export const SERIES_METADATA_FILE = "_series.md";

/** File name for volume metadata */
export const VOLUME_METADATA_FILE = "_volume.md";

/** Frontmatter keys */
export const FRONTMATTER_KEYS = {
	ID: "grimoire_id",
	TYPE: "grimoire_type",
	TITLE: "title",
	LAST_SYNCED: "last_synced",
	SERIES_ID: "series_id",
	VOLUME_ID: "volume_id",
	ORDER: "order",
	AUTHORS: "authors",
	ARTISTS: "artists",
	TAGS: "tags",
	COVER_IMAGE: "cover_image",
	PUBLICATION_DATE: "publication_date",
	ISBN: "isbn",
} as const;

/** Default page sizes for API requests */
export const DEFAULT_PAGE_SIZE = 50;

/** File extensions */
export const MARKDOWN_EXTENSION = ".md";
