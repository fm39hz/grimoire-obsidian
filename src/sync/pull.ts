/**
 * Pull sync - Fetch content from Grimoire API and write to vault
 */

import { Notice } from "obsidian";
import type { GrimoireApi } from "../api";
import type { FileManager, VaultStructure } from "../vault";
import type {
	SeriesResponse,
	VolumeResponse,
	ChapterResponse,
	SyncResult,
	PullOptions,
} from "../types";

export interface PullProgress {
	phase: "series" | "volumes" | "chapters";
	current: number;
	total: number;
	message: string;
}

export type ProgressCallback = (progress: PullProgress) => void;

export class PullSync {
	constructor(
		private api: GrimoireApi,
		private fileManager: FileManager,
		private structure: VaultStructure
	) {}

	/**
	 * Pull all series from the API
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

			// Fetch all series
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

			// Pull each series
			for (let i = 0; i < seriesList.length; i++) {
				const series = seriesList[i];
				if (!series) continue;
				
				onProgress?.({
					phase: "series",
					current: i + 1,
					total: seriesList.length,
					message: `Pulling series: ${series.title}`,
				});

				try {
					const seriesResult = await this.pullSeries(series.id!, onProgress);
					if (result.pulled && seriesResult.pulled) {
						result.pulled.series += seriesResult.pulled.series;
						result.pulled.volumes += seriesResult.pulled.volumes;
						result.pulled.chapters += seriesResult.pulled.chapters;
					}
					result.errors.push(...seriesResult.errors);
				} catch (error) {
					const message = error instanceof Error ? error.message : "Unknown error";
					result.errors.push(`Failed to pull series "${series.title}": ${message}`);
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
	 * Pull a specific series by ID
	 */
	async pullSeries(seriesId: string, onProgress?: ProgressCallback): Promise<SyncResult> {
		const result: SyncResult = {
			success: true,
			pulled: { series: 0, volumes: 0, chapters: 0 },
			errors: [],
		};

		try {
			// Fetch series details
			const series = await this.api.series.get(seriesId);

			if (!series.id || !series.title) {
				throw new Error("Invalid series data");
			}

			// Write series metadata file
			await this.fileManager.writeSeriesFile(series);
			if (result.pulled) {
				result.pulled.series = 1;
			}

			// Fetch volumes for this series
			const volumes = await this.api.series.getAllVolumes(seriesId);

			onProgress?.({
				phase: "volumes",
				current: 0,
				total: volumes.length,
				message: `Pulling ${volumes.length} volumes for "${series.title}"`,
			});

			// Pull each volume
			for (let i = 0; i < volumes.length; i++) {
				const volume = volumes[i];
				if (!volume) continue;

				onProgress?.({
					phase: "volumes",
					current: i + 1,
					total: volumes.length,
					message: `Pulling volume: ${volume.title}`,
				});

				try {
					const volumeResult = await this.pullVolume(volume, series.title, onProgress);
					if (result.pulled && volumeResult.pulled) {
						result.pulled.volumes += volumeResult.pulled.volumes;
						result.pulled.chapters += volumeResult.pulled.chapters;
					}
					result.errors.push(...volumeResult.errors);
				} catch (error) {
					const message = error instanceof Error ? error.message : "Unknown error";
					result.errors.push(`Failed to pull volume "${volume.title}": ${message}`);
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
	 * Pull a specific volume and its chapters
	 */
	async pullVolume(
		volume: VolumeResponse,
		seriesTitle: string,
		onProgress?: ProgressCallback
	): Promise<SyncResult> {
		const result: SyncResult = {
			success: true,
			pulled: { series: 0, volumes: 0, chapters: 0 },
			errors: [],
		};

		try {
			if (!volume.id || !volume.title) {
				throw new Error("Invalid volume data");
			}

			// Write volume metadata file
			await this.fileManager.writeVolumeFile(volume, seriesTitle);
			if (result.pulled) {
				result.pulled.volumes = 1;
			}

			// Fetch chapters for this volume
			const chapterList = await this.api.volumes.getAllChapters(volume.id);

			onProgress?.({
				phase: "chapters",
				current: 0,
				total: chapterList.length,
				message: `Pulling ${chapterList.length} chapters for "${volume.title}"`,
			});

			// Pull each chapter (need to fetch full content)
			for (let i = 0; i < chapterList.length; i++) {
				const chapterInfo = chapterList[i];
				if (!chapterInfo?.id) continue;

				onProgress?.({
					phase: "chapters",
					current: i + 1,
					total: chapterList.length,
					message: `Pulling chapter: ${chapterInfo.title}`,
				});

				try {
					// Fetch full chapter with content
					const chapter = await this.api.chapters.get(chapterInfo.id);

					if (!chapter.id || !chapter.title) {
						throw new Error("Invalid chapter data");
					}

					// Write chapter file
					await this.fileManager.writeChapterFile(chapter, seriesTitle, volume.title, volume.order);
					if (result.pulled) {
						result.pulled.chapters++;
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : "Unknown error";
					result.errors.push(`Failed to pull chapter "${chapterInfo.title}": ${message}`);
				}
			}

			result.success = result.errors.length === 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			result.errors.push(`Failed to pull volume: ${message}`);
			result.success = false;
		}

		return result;
	}
}
