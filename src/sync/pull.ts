/**
 * Pull sync - Fetch content from Grimoire API and write to vault
 * 
 * Sync flow:
 * 1. Sync all series first
 * 2. For each synced series → sync its volumes
 * 3. For each synced volume → sync its chapters
 */

import type { GrimoireApi } from "../api";
import type { FileManager, VaultStructure } from "../vault";
import type {
	SeriesResponse,
	VolumeResponse,
	ChapterListResponse,
	ChapterResponse,
	SyncResult,
	ImageSegment,
	Segment,
} from "../types";
import { App, TFile } from "obsidian";
import { joinPath } from "../utils";

export interface PullProgress {
	phase: "series" | "volumes" | "chapters";
	current: number;
	total: number;
	message: string;
}

export type ProgressCallback = (progress: PullProgress) => void;

/** Tracks a synced series with its metadata needed for volume sync */
interface SyncedSeries {
	id: string;
	title: string;
}

/** Tracks a synced volume with its metadata needed for chapter sync */
interface SyncedVolume {
	id: string;
	title: string;
	order: number;
	seriesTitle: string;
}

export class PullSync {
	constructor(
		private api: GrimoireApi,
		private fileManager: FileManager,
		private structure: VaultStructure,
		private app: App
	) {}

	/**
	 * Pull all series from the API
	 * 
	 * Flow: Sync all series → sync volumes for synced series → sync chapters for synced volumes
	 */
	async pullAllSeries(onProgress?: ProgressCallback): Promise<SyncResult> {
		const result: SyncResult = {
			success: true,
			pulled: { series: 0, volumes: 0, chapters: 0 },
			errors: [],
		};

		try {
			// Ensure sync folder exists
			await this.structure.ensureSyncFolder();

			// === PHASE 1: Sync all series ===
			onProgress?.({
				phase: "series",
				current: 0,
				total: 0,
				message: "Fetching series list...",
			});

			const seriesList = await this.api.series.listAll();

			onProgress?.({
				phase: "series",
				current: 0,
				total: seriesList.length,
				message: `Found ${seriesList.length} series`,
			});

			const syncedSeries: SyncedSeries[] = [];

			for (let i = 0; i < seriesList.length; i++) {
				const series = seriesList[i];
				if (!series?.id || !series.title) continue;

				onProgress?.({
					phase: "series",
					current: i + 1,
					total: seriesList.length,
					message: `Syncing series: ${series.title}`,
				});

				try {
					// Fetch series content separately
					const contentResponse = await this.api.series.getContent(series.id);
					if (contentResponse?.content) {
						series.markdown = contentResponse.content;
					}

					await this.syncSeriesFile(series);
					syncedSeries.push({ id: series.id, title: series.title });
					if (result.pulled) {
						result.pulled.series++;
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : "Unknown error";
					result.errors.push(`Failed to sync series "${series.title}": ${message}`);
				}
			}

			// === PHASE 2: Sync volumes for all synced series ===
			const syncedVolumes: SyncedVolume[] = [];
			let totalVolumes = 0;
			let volumeCount = 0;

			// First, count total volumes for progress
			const volumesBySeriesId = new Map<string, VolumeResponse[]>();
			for (const series of syncedSeries) {
				try {
					const volumes = await this.api.series.getAllVolumes(series.id);
					volumesBySeriesId.set(series.id, volumes);
					totalVolumes += volumes.length;
				} catch (error) {
					const message = error instanceof Error ? error.message : "Unknown error";
					result.errors.push(`Failed to fetch volumes for "${series.title}": ${message}`);
				}
			}

			onProgress?.({
				phase: "volumes",
				current: 0,
				total: totalVolumes,
				message: `Syncing ${totalVolumes} volumes...`,
			});

			for (const series of syncedSeries) {
				const volumes = volumesBySeriesId.get(series.id) ?? [];

				for (const volume of volumes) {
					if (!volume?.id || !volume.title) continue;

					volumeCount++;
					onProgress?.({
						phase: "volumes",
						current: volumeCount,
						total: totalVolumes,
						message: `Syncing volume: ${volume.title}`,
					});

					try {
						await this.syncVolumeFile(volume, series.title);
						syncedVolumes.push({
							id: volume.id,
							title: volume.title,
							order: volume.order ?? 0,
							seriesTitle: series.title,
						});
						if (result.pulled) {
							result.pulled.volumes++;
						}
					} catch (error) {
						const message = error instanceof Error ? error.message : "Unknown error";
						result.errors.push(`Failed to sync volume "${volume.title}": ${message}`);
					}
				}
			}

			// === PHASE 3: Sync chapters for all synced volumes ===
			let totalChapters = 0;
			let chapterCount = 0;

			// First, count total chapters for progress
			const chaptersByVolumeId = new Map<string, ChapterListResponse[]>();
			for (const volume of syncedVolumes) {
				try {
					const chapters = await this.api.volumes.getAllChapters(volume.id);
					chaptersByVolumeId.set(volume.id, chapters);
					totalChapters += chapters.length;
				} catch (error) {
					const message = error instanceof Error ? error.message : "Unknown error";
					result.errors.push(`Failed to fetch chapters for "${volume.title}": ${message}`);
				}
			}

			onProgress?.({
				phase: "chapters",
				current: 0,
				total: totalChapters,
				message: `Syncing ${totalChapters} chapters...`,
			});

			for (const volume of syncedVolumes) {
				const chapterList = chaptersByVolumeId.get(volume.id) ?? [];

				for (const chapterInfo of chapterList) {
					if (!chapterInfo.id) continue;

					chapterCount++;
					onProgress?.({
						phase: "chapters",
						current: chapterCount,
						total: totalChapters,
						message: `Syncing chapter: ${chapterInfo.title}`,
					});

					try {
						// Fetch full chapter metadata
						const chapter = await this.api.chapters.get(chapterInfo.id);
						
						// Fetch chapter content in markdown format
						const contentResponse = await this.api.chapters.getContent(chapterInfo.id);
						if (contentResponse?.content) {
							chapter.markdown = contentResponse.content;
						}
						
						// Process images in the chapter
						const processedChapter = await this.processChapterImages(chapter, volume.seriesTitle);

						await this.fileManager.writeChapterFile(
							processedChapter,
							volume.seriesTitle,
							volume.title,
							volume.order
						);
						if (result.pulled) {
							result.pulled.chapters++;
						}
					} catch (error) {
						const message = error instanceof Error ? error.message : "Unknown error";
						result.errors.push(`Failed to sync chapter "${chapterInfo.title}": ${message}`);
					}
				}
			}

			result.success = result.errors.length === 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			result.errors.push(`Pull failed: ${message}`);
			result.success = false;
		}

		return result;
	}

	/**
	 * Pull a specific series by ID (series + volumes + chapters)
	 */
	async pullSeries(seriesId: string, onProgress?: ProgressCallback): Promise<SyncResult> {
		const result: SyncResult = {
			success: true,
			pulled: { series: 0, volumes: 0, chapters: 0 },
			errors: [],
		};

		try {
			// === PHASE 1: Sync series ===
			const series = await this.api.series.get(seriesId);

			// Fetch series content in markdown format
			const contentResponse = await this.api.series.getContent(seriesId);
			if (contentResponse?.content) {
				series.markdown = contentResponse.content;
			}

			if (!series.id || !series.title) {
				throw new Error("Invalid series data");
			}

			onProgress?.({
				phase: "series",
				current: 1,
				total: 1,
				message: `Syncing series: ${series.title}`,
			});

			await this.syncSeriesFile(series);
			if (result.pulled) {
				result.pulled.series = 1;
			}

			// === PHASE 2: Sync volumes ===
			const volumes = await this.api.series.getAllVolumes(seriesId);

			onProgress?.({
				phase: "volumes",
				current: 0,
				total: volumes.length,
				message: `Syncing ${volumes.length} volumes for "${series.title}"`,
			});

			const syncedVolumes: SyncedVolume[] = [];

			for (let i = 0; i < volumes.length; i++) {
				const volume = volumes[i];
				if (!volume?.id || !volume.title) continue;

				onProgress?.({
					phase: "volumes",
					current: i + 1,
					total: volumes.length,
					message: `Syncing volume: ${volume.title}`,
				});

				try {
					await this.syncVolumeFile(volume, series.title);
					syncedVolumes.push({
						id: volume.id,
						title: volume.title,
						order: volume.order ?? 0,
						seriesTitle: series.title,
					});
					if (result.pulled) {
						result.pulled.volumes++;
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : "Unknown error";
					result.errors.push(`Failed to sync volume "${volume.title}": ${message}`);
				}
			}

			// === PHASE 3: Sync chapters for synced volumes ===
			let totalChapters = 0;
			let chapterCount = 0;

			const chaptersByVolumeId = new Map<string, ChapterListResponse[]>();
			for (const volume of syncedVolumes) {
				try {
					const chapters = await this.api.volumes.getAllChapters(volume.id);
					chaptersByVolumeId.set(volume.id, chapters);
					totalChapters += chapters.length;
				} catch (error) {
					const message = error instanceof Error ? error.message : "Unknown error";
					result.errors.push(`Failed to fetch chapters for "${volume.title}": ${message}`);
				}
			}

			onProgress?.({
				phase: "chapters",
				current: 0,
				total: totalChapters,
				message: `Syncing ${totalChapters} chapters...`,
			});

			for (const volume of syncedVolumes) {
				const chapterList = chaptersByVolumeId.get(volume.id) ?? [];

				for (const chapterInfo of chapterList) {
					if (!chapterInfo.id) continue;

					chapterCount++;
					onProgress?.({
						phase: "chapters",
						current: chapterCount,
						total: totalChapters,
						message: `Syncing chapter: ${chapterInfo.title}`,
					});

					try {
						const chapter = await this.api.chapters.get(chapterInfo.id);
						
						// Fetch chapter content in markdown format
						const contentResponse = await this.api.chapters.getContent(chapterInfo.id);
						if (contentResponse?.content) {
							chapter.markdown = contentResponse.content;
						}
						
						// Process images in the chapter
						const processedChapter = await this.processChapterImages(chapter, volume.seriesTitle);

						await this.fileManager.writeChapterFile(
							processedChapter,
							volume.seriesTitle,
							volume.title,
							volume.order
						);
						if (result.pulled) {
							result.pulled.chapters++;
						}
					} catch (error) {
						const message = error instanceof Error ? error.message : "Unknown error";
						result.errors.push(`Failed to sync chapter "${chapterInfo.title}": ${message}`);
					}
				}
			}

			result.success = result.errors.length === 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			result.errors.push(`Failed to pull series: ${message}`);
			result.success = false;
		}

		return result;
	}

	/**
	 * Sync a series file to the vault (metadata + cover image)
	 */
	private async syncSeriesFile(series: SeriesResponse): Promise<void> {
		if (!series.id || !series.title) {
			throw new Error("Invalid series data");
		}

		// Write series metadata file
		await this.fileManager.writeSeriesFile(series);

		// Download series cover image if available
		const coverImageId = series.metadata?.coverImage;
		if (coverImageId) {
			const seriesFolderPath = this.structure.getSeriesFolderPath(series.title);
			const filename = this.extractCoverFilename(coverImageId);
			await this.fileManager.downloadCoverImage(coverImageId, seriesFolderPath, filename);
		}
	}

	/**
	 * Sync a volume file to the vault (metadata + cover image)
	 */
	private async syncVolumeFile(volume: VolumeResponse, seriesTitle: string): Promise<void> {
		if (!volume.id || !volume.title) {
			throw new Error("Invalid volume data");
		}

		// Write volume metadata file
		await this.fileManager.writeVolumeFile(volume, seriesTitle);

		// Download volume cover image if available
		const volumeCoverId = volume.metadata?.coverImage;
		if (volumeCoverId) {
			const volumeFolderPath = this.structure.getVolumeFolderPath(
				seriesTitle,
				volume.title,
				volume.order
			);
			const filename = this.extractCoverFilename(volumeCoverId);
			await this.fileManager.downloadCoverImage(volumeCoverId, volumeFolderPath, filename);
		}
	}

	/**
	 * Process image segments in a chapter: download images and update references
	 */
	private async processChapterImages(
		chapter: ChapterResponse,
		seriesTitle: string
	): Promise<ChapterResponse> {
		if (!chapter.content || chapter.content.length === 0) {
			return chapter;
		}

		// Process each segment to find image segments
		const updatedContentPromises = chapter.content.map(async (segment) => {
			// Check if this is an image segment
			if (this.isImageSegment(segment)) {
				const imageSegment = segment;
				const src = imageSegment.src;
				
				if (src) {
					// Extract asset ID from the src (assuming it's in the format of an asset ID)
					const assetId = this.extractAssetIdFromSrc(src);
					if (assetId) {
						// Download the image and get the local path
						return await this.downloadAndUpdateImageReference(
							assetId,
							seriesTitle,
							imageSegment
						);
					}
				}
			}
			// Return unchanged segment if not an image or no src
			return segment;
		});

		// Wait for all promises to resolve
		const updatedContent = await Promise.all(updatedContentPromises);

		// Return chapter with updated content
		return {
			...chapter,
			content: updatedContent
		};
	}

	/**
	 * Check if a segment is an image segment
	 */
	private isImageSegment(segment: Segment): segment is ImageSegment {
		return 'src' in segment && 'width' in segment && 'height' in segment;
	}

	/**
	 * Extract asset ID from image src (implementation depends on how assets are referenced)
	 */
	private extractAssetIdFromSrc(src: string): string | null {
		// If src is already an asset ID (UUID), return it directly
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(src)) {
			return src;
		}
		
		// If src is a URL like /api/v1/files/{assetId}, extract the ID
		const match = src.match(/\/api\/v1\/files\/(.+)$/);
		if (match && match[1]) {
			return match[1];
		}
		
		// If src is just a filename, we might need to look it up differently
		// For now, return null to indicate we couldn't extract an ID
		return null;
	}

	/**
	 * Download an image and update its reference to point to local path
	 */
	private async downloadAndUpdateImageReference(
		assetId: string,
		seriesTitle: string,
		imageSegment: ImageSegment
	): Promise<ImageSegment> {
		try {
			// Download the image
			const buffer = await this.api.files.download(assetId);
			
			// Generate a filename (use asset ID or extract from original src if possible)
			const filename = this.extractFilenameFromSrc(imageSegment.src) ?? `${assetId}.bin`;
			
			// Save to series images folder
			const imagesFolderPath = this.structure.getSeriesImagesPath(seriesTitle);
			const normalizedPath = joinPath(imagesFolderPath, filename);
			
			const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
			if (existing instanceof TFile) {
				await this.app.vault.modifyBinary(existing, buffer);
			} else {
				await this.app.vault.createBinary(normalizedPath, buffer);
			}
			
			// Return updated image segment with local path
			return {
				...imageSegment,
				src: normalizedPath
			};
		} catch (error) {
			console.error(`Failed to download image ${assetId}:`, error);
			// Return original segment if download fails
			return imageSegment;
		}
	}

	/**
	 * Extract filename from src URL or path
	 */
	private extractFilenameFromSrc(src: string | null): string | null {
		if (!src) return null;
		
		// Handle URLs like /api/v1/files/asset-id (no filename in URL)
		// Handle paths like /path/to/image.jpg
		const normalizedSrc = src.replace(/\\/g, "/");
		const parts = normalizedSrc.split("/");
		const filename = parts[parts.length - 1];
		
		return filename && filename !== "" ? filename : null;
	}

	/**
	 * Extract filename from a cover image asset path
	 */
	private extractCoverFilename(assetPath: string): string {
		const parts = assetPath.replace(/\\/g, "/").split("/");
		return parts[parts.length - 1] || "cover.jpg";
	}
}
