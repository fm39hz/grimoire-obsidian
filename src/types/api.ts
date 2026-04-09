/**
 * API Types - Generated from Grimoire OpenAPI specification
 */

// ============================================================================
// Common Types
// ============================================================================

export interface PagedResult<T> {
	items: T[] | null;
	totalCount: number;
	pageIndex: number;
	pageSize: number;
	totalPages: number;
	hasPreviousPage: boolean;
	hasNextPage: boolean;
}

export interface ProblemDetails {
	type?: string | null;
	title?: string | null;
	status?: number | null;
	detail?: string | null;
	instance?: string | null;
}

// ============================================================================
// Text/Segment Types
// ============================================================================

export interface TextRun {
	text: string | null;
	isBold: boolean;
	isItalic: boolean;
	footnoteId?: string | null;
}

export interface Segment {
	id: string | null;
}

export interface TextSegment extends Segment {
	runs: TextRun[] | null;
}

export interface ImageSegment extends Segment {
	src: string | null;
	width: number | null;
	height: number | null;
}

export interface FootnoteSegment {
	id: string | null;
	segments: TextSegment[] | null;
}

// ============================================================================
// Series Types
// ============================================================================

export interface SeriesMetadata {
	authors?: string[] | null;
	artists?: string[] | null;
	tags?: string[] | null;
	description?: TextSegment[] | null;
	coverImage?: string | null;
}

export interface SeriesResponse {
	id: string | null;
	title: string | null;
	metadata?: SeriesMetadata | null;
	markdown?: string | null;
}

export interface CreateSeriesRequest {
	title?: string | null;
	metadata?: SeriesMetadata | null;
}

export interface UpdateSeriesRequest {
	title?: string | null;
	metadata?: SeriesMetadata | null;
}

// ============================================================================
// Volume Types
// ============================================================================

export interface VolumeMetadata {
	coverImage?: string | null;
	publicationDate?: string | null;
	isbn?: string | null;
}

export interface VolumeResponse {
	id: string | null;
	seriesId: string | null;
	order: number;
	title: string | null;
	metadata?: VolumeMetadata | null;
}

export interface CreateVolumeRequest {
	seriesId?: string | null;
	order?: number;
	title?: string | null;
	metadata?: VolumeMetadata | null;
}

export interface UpdateVolumeRequest {
	order?: number | null;
	title?: string | null;
	metadata?: VolumeMetadata | null;
}

// ============================================================================
// Chapter Types
// ============================================================================

export interface ChapterListResponse {
	id: string | null;
	volumeId: string | null;
	order: number;
	title: string | null;
}

export type ContentSegment = TextSegment | ImageSegment;

export interface ChapterResponse {
	id: string | null;
	volumeId: string | null;
	order: number;
	title: string | null;
	content: ContentSegment[] | null;
	footnotes: FootnoteSegment[] | null;
	markdown?: string | null;
}

export interface CreateChapterRequest {
	volumeId?: string | null;
	order?: number;
	title?: string | null;
	content?: Segment[] | null;
	footnotes?: ImportFootnote[] | null;
	rawContent?: string | null;
}

export interface UpdateChapterRequest {
	order?: number | null;
	title?: string | null;
	content?: Segment[] | null;
	footnotes?: FootnoteSegment[] | null;
}

export interface ImportFootnote {
	initialId?: string | null;
	segments?: TextSegment[] | null;
}

export interface SplitChapterRequest {
	splitPoints?: SplitPoint[] | null;
}

export interface SplitPoint {
	segmentIndex: number;
	newChapterTitle?: string | null;
}

// ============================================================================
// File/Asset Types
// ============================================================================

export interface AssetResponse {
	id: string;
	seriesId: string;
	path: string;
	fileHash: string;
	refType: string;
}

export type AssetRefType = "Content" | "Cover" | string;

// ============================================================================
// Bindery (Export) Types
// ============================================================================

export enum ExportFormat {
	Epub = 0,
	Pdf = 1,
	Mobi = 2,
	Html = 3,
}

export enum BookSection {
	Cover = 0,
	TitlePage = 1,
	Copyright = 2,
	TableOfContents = 3,
	Foreword = 4,
	Chapters = 5,
	Afterword = 6,
	Appendix = 7,
}

export interface ExportSection {
	type: BookSection;
	customCss?: string | null;
	options?: Record<string, unknown> | null;
}

export interface ExportStructure {
	sections?: ExportSection[] | null;
	globalCss?: string | null;
}

export interface BinderyRequest {
	format?: ExportFormat;
	mode?: string | null;
	targetVolumeIds?: string[] | null;
	structure?: ExportStructure | null;
}
