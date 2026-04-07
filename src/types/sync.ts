/**
 * Sync-related types for local tracking and frontmatter
 */

import type { SeriesMetadata, VolumeMetadata } from "./api";

// ============================================================================
// Frontmatter Types - Stored in YAML front matter of markdown files
// ============================================================================

export type GrimoireEntityType = "series" | "volume" | "chapter";

export interface BaseFrontmatter {
	grimoire_id: string;
	grimoire_type: GrimoireEntityType;
	title: string;
	last_synced: string; // ISO 8601 timestamp
}

export interface SeriesFrontmatter extends BaseFrontmatter {
	grimoire_type: "series";
	authors?: string[];
	artists?: string[];
	tags?: string[];
	cover_image?: string;
}

export interface VolumeFrontmatter extends BaseFrontmatter {
	grimoire_type: "volume";
	series_id: string;
	order: number;
	publication_date?: string;
	isbn?: string;
	cover_image?: string;
}

export interface ChapterFrontmatter extends BaseFrontmatter {
	grimoire_type: "chapter";
	volume_id: string;
	order: number;
}

export type Frontmatter = SeriesFrontmatter | VolumeFrontmatter | ChapterFrontmatter;

// ============================================================================
// Sync Status Types
// ============================================================================

export type SyncStatus = 
	| "idle"
	| "pulling"
	| "pushing"
	| "error";

export interface SyncState {
	status: SyncStatus;
	lastSync?: string;
	error?: string;
	progress?: {
		current: number;
		total: number;
		message: string;
	};
}

// ============================================================================
// Local Entity Types - Enriched with local file info
// ============================================================================

export interface LocalSeries {
	frontmatter: SeriesFrontmatter;
	description: string; // Markdown content
	folderPath: string;
	filePath: string; // Path to _series.md
}

export interface LocalVolume {
	frontmatter: VolumeFrontmatter;
	folderPath: string;
	filePath: string; // Path to _volume.md
}

export interface LocalChapter {
	frontmatter: ChapterFrontmatter;
	content: string; // Markdown content
	filePath: string;
}

// ============================================================================
// Sync Operation Types
// ============================================================================

export interface PullOptions {
	seriesId?: string;
	force?: boolean; // Ignore timestamps, pull everything
}

export interface PushOptions {
	seriesId?: string;
	force?: boolean; // Ignore timestamps, push everything
}

export interface SyncResult {
	success: boolean;
	pulled?: {
		series: number;
		volumes: number;
		chapters: number;
	};
	pushed?: {
		series: number;
		volumes: number;
		chapters: number;
	};
	errors: string[];
}

// ============================================================================
// Conversion Types
// ============================================================================

export interface ParsedMarkdown {
	content: string;
	footnotes: Map<string, string>; // footnoteId -> footnote content
}

export interface ConversionContext {
	seriesId: string;
	volumeId?: string;
	chapterId?: string;
	assetBaseUrl?: string;
}
