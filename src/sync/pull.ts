/**
 * Bidirectional sync - Sync content between Grimoire API and vault
 * 
 * Sync flow:
 * 1. Sync series (Pull/Push based on modification time)
 * 2. Sync volumes (Pull/Push based on modification time)
 * 3. Sync chapters (Pull/Push based on modification time, auto-creates new chapters)
 */

import type { GrimoireApi } from "../api";
import type { FileManager, VaultStructure } from "../vault";
import type {
	SeriesResponse,
	VolumeResponse,
	ChapterResponse,
	SyncResult,
	AssetListingDto,
	ChapterListResponse,
} from "../types";
import { App, TFile, TFolder, normalizePath } from "obsidian";
import { joinPath, extractOrderFromName } from "../utils";
import { parseFrontmatter } from "../vault/frontmatter";
import type { GrimoireSyncSettings } from "../settings";

export interface PullProgress {
	phase: "series" | "volumes" | "chapters";
	current: number;
	total: number;
	message: string;
}

export type ProgressCallback = (progress: PullProgress) => void;

interface SyncedSeries {
	id: string;
	title: string;
}

export class PullSync {
	constructor(
		private api: GrimoireApi,
		private fileManager: FileManager,
		private structure: VaultStructure,
		private app: App,
		private settings?: GrimoireSyncSettings
	) {}

	/**
	 * Pull/Sync all series from/to the API (Bidirectional Sync)
	 */
	async pullAllSeries(onProgress?: ProgressCallback): Promise<SyncResult> {
		const result: SyncResult = {
			success: true,
			pulled: { series: 0, volumes: 0, chapters: 0 },
			pushed: { series: 0, volumes: 0, chapters: 0 },
			errors: [],
		};

		try {
			await this.structure.ensureSyncFolder();

			onProgress?.({
				phase: "series",
				current: 0,
				total: 0,
				message: "Fetching series list...",
			});

			const remoteSeriesList = await this.api.series.listAll();
			const localSeriesList = await this.structure.findAllSeries();

			onProgress?.({
				phase: "series",
				current: 0,
				total: remoteSeriesList.length,
				message: `Found ${remoteSeriesList.length} series on server`,
			});

			const localSeriesMap = new Map<string, typeof localSeriesList[0]>();
			for (const ls of localSeriesList) {
				if (ls.frontmatter.grimoire_id) {
					localSeriesMap.set(ls.frontmatter.grimoire_id, ls);
				}
			}

			for (let i = 0; i < remoteSeriesList.length; i++) {
				const remote = remoteSeriesList[i];
				if (!remote?.id || !remote.title) continue;

				onProgress?.({
					phase: "series",
					current: i + 1,
					total: remoteSeriesList.length,
					message: `Syncing series: ${remote.title}`,
				});

				try {
					const local = localSeriesMap.get(remote.id);
					let activeSeriesTitle = remote.title;

					if (local) {
						const file = this.app.vault.getAbstractFileByPath(local.metadataPath);
						if (file instanceof TFile) {
							const localEdited = this.isLocallyModified(file);
							const remoteNewer = this.isRemoteNewer(remote.updatedAt, file);
							activeSeriesTitle = local.frontmatter.title || remote.title;

							if (localEdited && remoteNewer) {
								const localTime = file.stat.mtime;
								const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
								if (localTime > remoteTime) {
									await this.pushSeries(file, remote);
									result.pushed!.series++;
								} else {
									await this.pullSeriesMetadata(remote);
									result.pulled!.series++;
								}
							} else if (localEdited) {
								await this.pushSeries(file, remote);
								result.pushed!.series++;
							} else if (remoteNewer) {
								await this.pullSeriesMetadata(remote);
								result.pulled!.series++;
							}
						}
					} else {
						await this.pullSeriesMetadata(remote);
						result.pulled!.series++;
					}

					// Sync volumes for this series
					await this.syncVolumes(remote, activeSeriesTitle, result, onProgress);
				} catch (error) {
					const message = error instanceof Error ? error.message : "Unknown error";
					result.errors.push(`Failed to sync series "${remote.title}": ${message}`);
				}
			}

			result.success = result.errors.length === 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			result.errors.push(`Sync failed: ${message}`);
			result.success = false;
		}

		return result;
	}

	/**
	 * Pull/Sync a specific series by ID (Bidirectional Sync)
	 */
	async pullSeries(seriesId: string, onProgress?: ProgressCallback): Promise<SyncResult> {
		const result: SyncResult = {
			success: true,
			pulled: { series: 0, volumes: 0, chapters: 0 },
			pushed: { series: 0, volumes: 0, chapters: 0 },
			errors: [],
		};

		try {
			const remote = await this.api.series.get(seriesId);
			if (!remote.id || !remote.title) {
				throw new Error("Invalid series data");
			}

			const localSeries = await this.structure.findSeriesById(seriesId);
			let activeSeriesTitle = remote.title;

			if (localSeries) {
				const file = this.app.vault.getAbstractFileByPath(localSeries.metadataPath);
				if (file instanceof TFile) {
					const localEdited = this.isLocallyModified(file);
					const remoteNewer = this.isRemoteNewer(remote.updatedAt, file);
					activeSeriesTitle = localSeries.frontmatter.title || remote.title;

					if (localEdited && remoteNewer) {
						const localTime = file.stat.mtime;
						const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
						if (localTime > remoteTime) {
							await this.pushSeries(file, remote);
							result.pushed!.series++;
						} else {
							await this.pullSeriesMetadata(remote);
							result.pulled!.series++;
						}
					} else if (localEdited) {
						await this.pushSeries(file, remote);
						result.pushed!.series++;
					} else if (remoteNewer) {
						await this.pullSeriesMetadata(remote);
						result.pulled!.series++;
					}
				}
			} else {
				await this.pullSeriesMetadata(remote);
				result.pulled!.series++;
			}

			await this.syncVolumes(remote, activeSeriesTitle, result, onProgress);
			result.success = result.errors.length === 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			result.errors.push(`Failed to sync series: ${message}`);
			result.success = false;
		}

		return result;
	}

	/**
	 * Sync volumes for a series
	 */
	private async syncVolumes(
		series: SeriesResponse,
		seriesTitle: string,
		result: SyncResult,
		onProgress?: ProgressCallback
	): Promise<void> {
		const remoteVolumes = await this.api.series.getAllVolumes(series.id!);
		const seriesFolderPath = this.structure.getSeriesFolderPath(seriesTitle);
		const localVolumes = await this.structure.findVolumesInSeries(seriesFolderPath);

		const localVolumeMap = new Map<string, typeof localVolumes[0]>();
		for (const lv of localVolumes) {
			if (lv.frontmatter.grimoire_id) {
				localVolumeMap.set(lv.frontmatter.grimoire_id, lv);
			}
		}

		for (const remote of remoteVolumes) {
			if (!remote?.id || !remote.title) continue;

			try {
				const local = localVolumeMap.get(remote.id);
				let activeVolumeTitle = remote.title;
				let activeVolumeOrder = remote.order;

				const remoteChapters = await this.api.volumes.getAllChapters(remote.id);

				if (local) {
					const file = this.app.vault.getAbstractFileByPath(local.metadataPath);
					if (file instanceof TFile) {
						const localEdited = this.isLocallyModified(file);
						const remoteNewer = this.isRemoteNewer(remote.updatedAt, file);
						activeVolumeTitle = local.frontmatter.title || remote.title;
						activeVolumeOrder = local.frontmatter.order;

						if (localEdited && remoteNewer) {
							const localTime = file.stat.mtime;
							const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
							if (localTime > remoteTime) {
								await this.pushVolume(file, remote, seriesTitle, remoteChapters);
								result.pushed!.volumes++;
							} else {
								await this.syncVolumeFile(remote, seriesTitle, remoteChapters);
								result.pulled!.volumes++;
							}
						} else if (localEdited) {
							await this.pushVolume(file, remote, seriesTitle, remoteChapters);
							result.pushed!.volumes++;
						} else if (remoteNewer) {
							await this.syncVolumeFile(remote, seriesTitle, remoteChapters);
							result.pulled!.volumes++;
						}
					}
				} else {
					await this.syncVolumeFile(remote, seriesTitle, remoteChapters);
					result.pulled!.volumes++;
				}

				// Sync chapters for this volume
				const volumeFolderPath = this.structure.getVolumeFolderPath(seriesTitle, activeVolumeTitle, activeVolumeOrder);
				await this.syncChapters(remote, series, seriesTitle, activeVolumeTitle, activeVolumeOrder, volumeFolderPath, result, onProgress, remoteChapters);
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				result.errors.push(`Failed to sync volume "${remote.title}": ${message}`);
			}
		}
	}

	/**
	 * Sync chapters for a volume
	 */
	private async syncChapters(
		volume: VolumeResponse,
		series: SeriesResponse,
		seriesTitle: string,
		volumeTitle: string,
		volumeOrder: number,
		volumeFolderPath: string,
		result: SyncResult,
		onProgress?: ProgressCallback,
		prefetchedChapters?: ChapterListResponse[]
	): Promise<void> {
		const localChapters = await this.structure.findChaptersInVolume(volumeFolderPath);
		const remoteChapters = prefetchedChapters || await this.api.volumes.getAllChapters(volume.id!);

		const localChapterMap = new Map<string, typeof localChapters[0]>();
		const localNewChapters: typeof localChapters = [];
		for (const lc of localChapters) {
			if (lc.frontmatter.grimoire_id) {
				localChapterMap.set(lc.frontmatter.grimoire_id, lc);
			} else {
				localNewChapters.push(lc);
			}
		}

		// 1. Sync remote chapters
		for (const rc of remoteChapters) {
			if (!rc.id) continue;
			const lc = localChapterMap.get(rc.id);

			try {
				if (lc) {
					const file = this.app.vault.getAbstractFileByPath(lc.filePath);
					if (file instanceof TFile) {
						const localEdited = this.isLocallyModified(file);
						const remoteNewer = this.isRemoteNewer(rc.updatedAt, file);

						if (localEdited && remoteNewer) {
							const localTime = file.stat.mtime;
							const remoteTime = rc.updatedAt ? new Date(rc.updatedAt).getTime() : 0;
							if (localTime > remoteTime) {
								await this.pushChapter(file, rc, volume.id!, seriesTitle, volumeTitle, volumeOrder);
								result.pushed!.chapters++;
							} else {
								await this.pullChapter(rc.id, seriesTitle, volumeTitle, volumeOrder);
								result.pulled!.chapters++;
							}
						} else if (localEdited) {
							await this.pushChapter(file, rc, volume.id!, seriesTitle, volumeTitle, volumeOrder);
							result.pushed!.chapters++;
						} else if (remoteNewer) {
							await this.pullChapter(rc.id, seriesTitle, volumeTitle, volumeOrder);
							result.pulled!.chapters++;
						}
					}
				} else {
					await this.pullChapter(rc.id, seriesTitle, volumeTitle, volumeOrder);
					result.pulled!.chapters++;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				result.errors.push(`Failed to sync chapter "${rc.title}": ${message}`);
			}
		}

		// 2. Create local-only chapters on server
		for (const lc of localNewChapters) {
			try {
				const file = this.app.vault.getAbstractFileByPath(lc.filePath);
				if (file instanceof TFile) {
					await this.pushChapter(file, null, volume.id!, seriesTitle, volumeTitle, volumeOrder);
					result.pushed!.chapters++;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				result.errors.push(`Failed to create chapter "${lc.frontmatter.title}": ${message}`);
			}
		}
	}

	/**
	 * Pull series metadata & description
	 */
	private async pullSeriesMetadata(series: SeriesResponse): Promise<void> {
		const contentResponse = await this.api.series.getContent(series.id!);
		if (contentResponse?.data) {
			series.markdown = contentResponse.data;
		}
		if (contentResponse?.assets && contentResponse.assets.length > 0) {
			series.markdown = await this.processContentAssets(
				contentResponse.assets,
				series.markdown ?? "",
				series.title!
			);
		}
		const volumes = await this.api.series.getAllVolumes(series.id!);
		await this.syncSeriesFile(series, volumes);
	}

	/**
	 * Pull a single chapter by ID
	 */
	private async pullChapter(id: string, seriesTitle: string, volumeTitle: string, volumeOrder: number): Promise<void> {
		const chapter = await this.api.chapters.get(id);
		const footnoteStyle = this.settings?.footnoteStyle;
		const enableDropcap = this.settings?.enableDropcap;
		const contentResponse = await this.api.chapters.getContent(id, "markdown", footnoteStyle, enableDropcap);
		if (contentResponse?.data) {
			chapter.markdown = contentResponse.data;
		}
		if (contentResponse?.assets && contentResponse.assets.length > 0) {
			chapter.markdown = await this.processContentAssets(
				contentResponse.assets,
				chapter.markdown ?? "",
				seriesTitle
			);
		}
		await this.fileManager.writeChapterFile(chapter, seriesTitle, volumeTitle, volumeOrder);
	}

	/**
	 * Push local series changes to server
	 */
	private async pushSeries(file: TFile, remoteSeries: SeriesResponse): Promise<void> {
		const content = await this.app.vault.read(file);
		const { frontmatter } = parseFrontmatter(content);

		const title = String(frontmatter?.["title"] || remoteSeries.title || "");
		const authors = (frontmatter?.["authors"] as string[]) || [];
		const artists = (frontmatter?.["artists"] as string[]) || [];
		const tags = (frontmatter?.["tags"] as string[]) || [];

		const updatedRemote = await this.api.series.update(remoteSeries.id!, {
			title,
			metadata: {
				authors,
				artists,
				tags,
				description: remoteSeries.metadata?.description || []
			}
		});

		const volumes = await this.api.series.getAllVolumes(remoteSeries.id!);
		await this.fileManager.writeSeriesFile(updatedRemote, volumes);
	}

	/**
	 * Push local volume changes to server
	 */
	private async pushVolume(
		file: TFile,
		remoteVolume: VolumeResponse,
		seriesTitle: string,
		chapters?: ChapterListResponse[]
	): Promise<void> {
		const content = await this.app.vault.read(file);
		const { frontmatter } = parseFrontmatter(content);

		const title = String(frontmatter?.["title"] || remoteVolume.title || "");
		const order = Number(frontmatter?.["order"]) || remoteVolume.order || 0;
		const publicationDate = (frontmatter?.["publication_date"] as string) || undefined;
		const isbn = (frontmatter?.["isbn"] as string) || undefined;

		const updatedRemote = await this.api.volumes.update(remoteVolume.id!, {
			title,
			order,
			metadata: {
				publicationDate,
				isbn,
				coverImage: remoteVolume.metadata?.coverImage || undefined
			}
		});

		const finalChapters = chapters || await this.api.volumes.getAllChapters(remoteVolume.id!);
		await this.fileManager.writeVolumeFile(updatedRemote, seriesTitle, finalChapters);

		const newMetadataPath = this.structure.getVolumeMetadataPath(seriesTitle, title, order);
		if (normalizePath(file.path) !== normalizePath(newMetadataPath)) {
			await this.app.fileManager.trashFile(file);
		}
	}

	/**
	 * Push local chapter changes to server
	 */
	private async pushChapter(
		file: TFile,
		remoteChapter: any,
		volumeId: string,
		seriesTitle: string,
		volumeTitle: string,
		volumeOrder: number
	): Promise<void> {
		const content = await this.app.vault.read(file);
		const { frontmatter, content: body } = parseFrontmatter(content);

		const title = String(frontmatter?.["title"] || file.basename.replace(/^\d+\s*-\s*/, ""));
		const order = Number(frontmatter?.["order"]) || extractOrderFromName(file.basename) || 0;

		if (remoteChapter && remoteChapter.id) {
			if (title !== remoteChapter.title || order !== remoteChapter.order) {
				await this.api.chapters.update(remoteChapter.id, {
					title,
					order
				});
			}
		}

		const updatedChapter = await this.api.chapters.create({
			volumeId,
			order,
			title,
			rawContent: body
		});

		await this.fileManager.writeChapterFile(updatedChapter, seriesTitle, volumeTitle, volumeOrder);

		const newFilePath = this.structure.getChapterFilePath(seriesTitle, volumeTitle, volumeOrder, title, order);
		if (normalizePath(file.path) !== normalizePath(newFilePath)) {
			await this.app.fileManager.trashFile(file);
		}
	}

	/**
	 * Helper to get local last synced timestamp
	 */
	private getLocalLastSynced(file: TFile): number {
		const cache = this.app.metadataCache.getFileCache(file);
		const lastSynced = cache?.frontmatter?.["last_synced"];
		if (!lastSynced) return 0;
		return new Date(lastSynced).getTime();
	}

	/**
	 * Helper to check if file was modified locally since last sync
	 */
	private isLocallyModified(file: TFile): boolean {
		const lastSynced = this.getLocalLastSynced(file);
		if (lastSynced === 0) return true;
		return file.stat.mtime > lastSynced + 5000;
	}

	/**
	 * Helper to check if remote was modified since last sync
	 */
	private isRemoteNewer(remoteUpdatedAt: string | null | undefined, file: TFile): boolean {
		if (!remoteUpdatedAt) return false;
		const lastSynced = this.getLocalLastSynced(file);
		const remoteTime = new Date(remoteUpdatedAt).getTime();
		return remoteTime > lastSynced + 5000;
	}

	/**
	 * Sync a series file to the vault (metadata + cover image)
	 */
	private async syncSeriesFile(series: SeriesResponse, volumes?: VolumeResponse[]): Promise<void> {
		if (!series.id || !series.title) {
			throw new Error("Invalid series data");
		}

		await this.fileManager.writeSeriesFile(series, volumes);

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
	private async syncVolumeFile(
		volume: VolumeResponse,
		seriesTitle: string,
		chapters?: ChapterListResponse[]
	): Promise<void> {
		if (!volume.id || !volume.title) {
			throw new Error("Invalid volume data");
		}

		await this.fileManager.writeVolumeFile(volume, seriesTitle, chapters);

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
	 * Process assets from content response: download images and update references in markdown
	 */
	private async processContentAssets(
		assets: AssetListingDto[],
		markdown: string,
		seriesTitle: string
	): Promise<string> {
		let processedMarkdown = markdown;

		for (const asset of assets) {
			if (!asset.id || !asset.fileName) continue;

			try {
				const buffer = await this.api.files.download(asset.id);

				const imagesFolderPath = this.structure.getSeriesImagesPath(seriesTitle);
				await this.structure.ensureFolder(imagesFolderPath);
				const normalizedPath = joinPath(imagesFolderPath, asset.fileName);

				const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
				if (existing instanceof TFile) {
					await this.app.vault.modifyBinary(existing, buffer);
				} else {
					await this.app.vault.createBinary(normalizedPath, buffer);
				}

				const encodedPath = normalizedPath.split("/").map(encodeURIComponent).join("/");
				const refPattern = `](${asset.id})`;
				while (processedMarkdown.includes(refPattern)) {
					processedMarkdown = processedMarkdown.replace(refPattern, `](${encodedPath})`);
				}
			} catch (error) {
				console.error(`Failed to download asset ${asset.id} (${asset.fileName}):`, error);
			}
		}

		return processedMarkdown;
	}

	/**
	 * Extract filename from a cover image asset path
	 */
	private extractCoverFilename(assetPath: string): string {
		const parts = assetPath.replace(/\\/g, "/").split("/");
		return parts[parts.length - 1] || "cover.jpg";
	}
}
