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

export interface FootnoteSegment {
	id: string | null;
	segments: TextSegment[] | null;
}

// ============================================================================
// Content Response (used by /content endpoints)
// ============================================================================

export interface AssetListingDto {
	id: string | null;
	refType: string | null;
	fileName: string | null;
}

export interface ContentResponseDto {
	data: string | null;
	type: string | null;
	assets: AssetListingDto[] | null;
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
	revision?: number;
	metadata?: SeriesMetadata | null;
	markdown?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
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
	createdAt?: string | null;
	updatedAt?: string | null;
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
	seriesId?: string | null;
}

// ============================================================================
// Chapter Types
// ============================================================================

export interface ChapterListResponse {
	id: string | null;
	volumeId: string | null;
	order: number;
	title: string | null;
	updatedAt?: string | null;
}

export interface ChapterResponse {
	id: string | null;
	volumeId: string | null;
	order: number;
	title: string | null;
	content: Segment[] | null;
	footnotes: FootnoteSegment[] | null;
	markdown?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
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
	volumeId?: string | null;
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

export type AssetRefType = "Content" | "Cover" | (string & {});

// ============================================================================
// Bindery (Export) Types
// ============================================================================

export enum ExportFormat {
	Epub = 0,
	Pdf = 1,
	Mobi = 2,
	Html = 3,
	Docx = 4,
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
	mode?: "Anthology" | "Single" | "OnePerVolume" | "CustomGroups" | null;
	targetVolumeIds?: string[] | null;
	groups?: ExportGroup[] | null;
	structure?: ExportStructure | null;
}

export interface ExportGroup {
	name: string;
	targetVolumeIds: string[];
}

export interface PublishArtifact {
	name: string;
	fileName: string;
	contentType: string;
	volumeIds: string[];
	size: number;
	sha256: string;
}

// ============================================================================
// Job Types
// ============================================================================

export interface JobResponse {
	jobId: string;
	status: string;
	downloadUrl?: string | null;
	error?: string | null;
	progress?: number | null;
	stage?: string | null;
	fileName?: string | null;
	contentType?: string | null;
	artifacts?: PublishArtifact[] | null;
	message?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
}

// ============================================================================
// Book Tree Types
// ============================================================================

export enum BookTreeNodeType {
	BookShelf = "bookshelf",
	Series = "series",
	Volume = "volume",
	Chapter = "chapter",
}

export interface BookTreeNodeDto {
	id: string;
	type: BookTreeNodeType;
	title: string;
	order?: number | null;
	contentHash?: string | null;
	parentId?: string | null;
	children: BookTreeNodeDto[];
}

export interface BookTreeDto {
	root: BookTreeNodeDto;
}

// ============================================================================
// Sync Tree Types
// ============================================================================

export interface SyncChapterDto {
	order: number;
	title: string;
	content?: Segment[] | null;
	footnotes?: ImportFootnote[] | null;
	rawContent?: string | null;
}

export interface SyncVolumeDto {
	order: number;
	title: string;
	metadata?: VolumeMetadata | null;
	chapters: SyncChapterDto[];
}

export interface SyncSeriesRequestDto {
	volumes: SyncVolumeDto[];
}

// ============================================================================
// Merge Chapter Types
// ============================================================================

export interface MergeChaptersRequest {
	chapterIds: string[];
}
