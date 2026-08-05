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
import { App, TFile, TFolder, normalizePath, Notice } from "obsidian";
import { joinPath } from "../utils";
import { parseFrontmatter, createMarkdownWithFrontmatter } from "../vault/frontmatter";
import type { GrimoireSyncSettings } from "../settings";
import { SyncIndex } from "./sync-index";

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

export class BidirectionalSync {
	constructor(
		private api: GrimoireApi,
		private fileManager: FileManager,
		private structure: VaultStructure,
		private app: App,
		private settings?: GrimoireSyncSettings,
		private syncIndex?: SyncIndex
	) {}

	private async getOrCreateSyncIndex(): Promise<SyncIndex> {
		if (!this.syncIndex) {
			this.syncIndex = new SyncIndex(this.app);
			await this.syncIndex.load();
		}
		return this.syncIndex;
	}

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

			// Resolve local folder restructuring first
			await this.resolveLocalRestructuring();

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
			// Resolve local folder restructuring first
			await this.resolveLocalRestructuring();

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

		// Sort remote chapters by order ascending
		const sortedRemoteChapters = [...remoteChapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

		const localChapterMap = new Map<string, typeof localChapters[0]>();
		const localNewChapters: typeof localChapters = [];
		for (const lc of localChapters) {
			if (lc.frontmatter.grimoire_id) {
				localChapterMap.set(lc.frontmatter.grimoire_id, lc);
			} else {
				localNewChapters.push(lc);
			}
		}

		const syncedRemoteIds = new Set<string>();

		// 1. Sync remote chapters
		for (let i = 0; i < sortedRemoteChapters.length; i++) {
			const rc = sortedRemoteChapters[i]!;
			if (!rc.id || !rc.title) continue;
			syncedRemoteIds.add(rc.id);
			const lc = localChapterMap.get(rc.id);
			const displayOrder = i + 1;

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
								await this.pushChapter(file, rc, volume.id!, seriesTitle, volumeTitle, volumeOrder, displayOrder);
								result.pushed!.chapters++;
							} else {
								await this.pullChapter(rc.id, seriesTitle, volumeTitle, volumeOrder, file, displayOrder);
								result.pulled!.chapters++;
							}
						} else if (localEdited) {
							await this.pushChapter(file, rc, volume.id!, seriesTitle, volumeTitle, volumeOrder, displayOrder);
							result.pushed!.chapters++;
						} else if (remoteNewer) {
							await this.pullChapter(rc.id, seriesTitle, volumeTitle, volumeOrder, file, displayOrder);
							result.pulled!.chapters++;
						} else {
							// Update title/order and rename file for non-affected chapters purely locally if needed
							const expectedPath = this.structure.getChapterFilePath(
								seriesTitle,
								volumeTitle,
								volumeOrder,
								rc.title,
								displayOrder
							);

							if (
								normalizePath(lc.filePath) !== normalizePath(expectedPath) ||
								lc.frontmatter.order !== rc.order ||
								lc.frontmatter.title !== rc.title
							) {
								await this.fileManager.updateFrontmatter(file.path, {
									title: rc.title,
									order: rc.order,
									last_synced: new Date().toISOString()
								});

								if (normalizePath(file.path) !== normalizePath(expectedPath)) {
									const content = await this.app.vault.read(file);
									await this.fileManager.writeFile(expectedPath, content);
									await this.app.fileManager.trashFile(file);
								}
							}
						}
					}
				} else {
					await this.pullChapter(rc.id, seriesTitle, volumeTitle, volumeOrder, undefined, displayOrder);
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

		// 3. Delete local chapters that are no longer on the server
		for (const [gid, lc] of localChapterMap.entries()) {
			if (!syncedRemoteIds.has(gid)) {
				try {
					const file = this.app.vault.getAbstractFileByPath(lc.filePath);
					if (file instanceof TFile) {
						await this.app.fileManager.trashFile(file);
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : "Unknown error";
					result.errors.push(`Failed to delete local-only chapter "${lc.frontmatter.title}": ${message}`);
				}
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
	public async pullChapter(
		id: string,
		seriesTitle: string,
		volumeTitle: string,
		volumeOrder: number,
		oldFile?: TFile,
		displayOrder?: number
	): Promise<void> {
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

		if (oldFile && this.isLocallyModified(oldFile)) {
			const conflictPath = oldFile.path.replace(/\.md$/, ".conflict.md");
			const frontmatter = {
				grimoire_id: chapter.id,
				title: `${chapter.title} (Server Conflict)`,
				grimoire_type: "chapter_conflict",
				last_synced: new Date().toISOString()
			};
			await this.fileManager.writeFile(conflictPath, createMarkdownWithFrontmatter(frontmatter, chapter.markdown ?? ""));
			new Notice(`Conflict detected! Server version saved to ${conflictPath}`);
			return;
		}

		const newFilePath = await this.fileManager.writeChapterFile(chapter, seriesTitle, volumeTitle, volumeOrder, displayOrder);
		if (oldFile && normalizePath(oldFile.path) !== normalizePath(newFilePath)) {
			await this.app.fileManager.trashFile(oldFile);
		}

		if (newFilePath) {
			const writtenFile = this.app.vault.getAbstractFileByPath(normalizePath(newFilePath));
			if (writtenFile instanceof TFile) {
				const writtenContent = await this.app.vault.read(writtenFile);
				const { content: body } = parseFrontmatter(writtenContent);
				const syncIndex = await this.getOrCreateSyncIndex();
				const localHash = await syncIndex.computeHash(body);
				const remoteHash = await syncIndex.computeHash(chapter.markdown ?? "");
				
				syncIndex.setEntry(newFilePath, localHash, remoteHash);
				await syncIndex.save();
			}
		}
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
	public async pushChapter(
		file: TFile,
		remoteChapter: any,
		volumeId: string,
		seriesTitle: string,
		volumeTitle: string,
		volumeOrder: number,
		displayOrder?: number,
		skipWrite?: boolean
	): Promise<void> {
		const content = await this.app.vault.read(file);
		const { frontmatter, content: body } = parseFrontmatter(content);

		const title = String(frontmatter?.["title"] || file.basename);
		const order = Number(frontmatter?.["order"]) || 0;

		// 1. Resolve Series ID from series metadata file cache to upload images
		const seriesMetadataPath = this.structure.getSeriesMetadataPath(seriesTitle);
		const seriesFile = this.app.vault.getAbstractFileByPath(seriesMetadataPath);
		let seriesId = "";
		if (seriesFile instanceof TFile) {
			const cache = this.app.metadataCache.getFileCache(seriesFile);
			const fm = cache?.frontmatter || parseFrontmatter(await this.app.vault.read(seriesFile)).frontmatter;
			seriesId = fm?.["grimoire_id"] || "";
		}

		let updatedBody = body;

		// 2. Scan and upload local images (Wikilinks: ![[image.png]])
		if (seriesId) {
			const wikilinkRegex = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
			let match;
			while ((match = wikilinkRegex.exec(body)) !== null) {
				const linkpath = match[1]?.trim();
				if (!linkpath) continue;
				const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
				if (targetFile instanceof TFile) {
					const arrayBuffer = await this.app.vault.readBinary(targetFile);
					const asset = await this.api.files.upload(seriesId, arrayBuffer, targetFile.name, "Content");
					updatedBody = updatedBody.replace(match[0], `![${targetFile.basename}](${asset.id})`);
				}
			}

			// Scan and upload local images (Markdown: ![alt](image.png))
			const markdownRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
			while ((match = markdownRegex.exec(body)) !== null) {
				const altText = match[1] || "";
				const linkpath = match[2]?.trim();
				if (linkpath && !linkpath.startsWith("http://") && !linkpath.startsWith("https://") && !linkpath.startsWith("/api/")) {
					const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
					if (targetFile instanceof TFile) {
						const arrayBuffer = await this.app.vault.readBinary(targetFile);
						const asset = await this.api.files.upload(seriesId, arrayBuffer, targetFile.name, "Content");
						updatedBody = updatedBody.replace(match[0], `![${altText}](${asset.id})`);
					}
				}
			}
		}

		if (remoteChapter && remoteChapter.id) {
			// If the chapter exists, we update its metadata (title, order) on the server first.
			if (title !== remoteChapter.title || order !== remoteChapter.order) {
				await this.api.chapters.update(remoteChapter.id, {
					title,
					order
				});
			}
		}

		// To update the content (or create a new chapter), we call the Create (upsert) endpoint.
		const updatedChapter = await this.api.chapters.create({
			volumeId,
			order,
			title,
			rawContent: updatedBody
		}, {
			format: "markdown",
			footnoteStyle: this.settings?.footnoteStyle,
			enableDropcap: this.settings?.enableDropcap
		});

		let finalFilePath = file.path;

		if (!skipWrite) {
			const newFilePath = await this.fileManager.writeChapterFile(updatedChapter, seriesTitle, volumeTitle, volumeOrder, displayOrder);
			if (newFilePath) {
				finalFilePath = newFilePath;
			}
			if (normalizePath(file.path) !== normalizePath(newFilePath)) {
				await this.app.fileManager.trashFile(file);
			}
		}

		// 3. Update Sync Index with final hash
		const writtenFile = this.app.vault.getAbstractFileByPath(normalizePath(finalFilePath));
		if (writtenFile instanceof TFile) {
			const writtenContent = await this.app.vault.read(writtenFile);
			const { content: finalBody } = parseFrontmatter(writtenContent);
			const syncIndex = await this.getOrCreateSyncIndex();
			const localHash = await syncIndex.computeHash(finalBody);
			
			syncIndex.setEntry(finalFilePath, localHash, localHash);
			await syncIndex.save();
		}
	}

	/**
	 * Helper to get local last synced timestamp
	 */
	private getLocalLastSynced(file: TFile): number {
		if (this.syncIndex) {
			const entry = this.syncIndex.getEntry(file.path);
			if (entry) return entry.lastSyncedAt;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		const lastSynced = cache?.frontmatter?.["last_synced"];
		if (!lastSynced) return 0;
		return new Date(lastSynced).getTime();
	}

	/**
	 * Helper to check if file was modified locally since last sync
	 */
	public isLocallyModified(file: TFile): boolean {
		if (!this.syncIndex) return true;
		const entry = this.syncIndex.getEntry(file.path);
		if (!entry) return true;
		return file.stat.mtime > entry.lastSyncedAt + 1000;
	}

	/**
	 * Helper to check if remote was modified since last sync
	 */
	private isRemoteNewer(remoteUpdatedAt: string | null | undefined, file: TFile): boolean {
		if (!remoteUpdatedAt) return false;
		if (!this.syncIndex) return true;
		const entry = this.syncIndex.getEntry(file.path);
		if (!entry) return true;
		const remoteTime = new Date(remoteUpdatedAt).getTime();
		return remoteTime > entry.lastSyncedAt + 1000;
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

	/**
	 * Detect and resolve local folder restructuring (moved volumes or chapters)
	 * by updating parent-child relationships on the server and local frontmatter.
	 */
	private async resolveLocalRestructuring(): Promise<void> {
		if (this.settings?.includeFrontmatter === false) {
			return;
		}

		const localSeriesList = await this.structure.findAllSeries();

		for (const ls of localSeriesList) {
			const seriesId = ls.frontmatter.grimoire_id;
			if (!seriesId) continue;

			// Check volumes in this series folder
			const localVolumes = await this.structure.findVolumesInSeries(ls.folderPath);
			for (const lv of localVolumes) {
				const volumeId = lv.frontmatter.grimoire_id;
				if (!volumeId) continue;

				// 1. If the volume's logically stored series_id doesn't match its physical parent seriesId, it has been moved
				if (lv.frontmatter.series_id !== seriesId) {
					try {
						await this.api.volumes.update(volumeId, { seriesId });
						await this.fileManager.updateFrontmatter(lv.metadataPath, { series_id: seriesId });
						lv.frontmatter.series_id = seriesId;
					} catch (error) {
						console.error(`Failed to update series parent for volume ${volumeId}:`, error);
					}
				}

				// Check chapters in this volume folder
				const localChapters = await this.structure.findChaptersInVolume(lv.folderPath);
				for (const lc of localChapters) {
					const chapterId = lc.frontmatter.grimoire_id;
					if (!chapterId) continue;

					// 2. If the chapter's logically stored volume_id doesn't match its physical parent volumeId, it has been moved
					if (lc.frontmatter.volume_id !== volumeId) {
						try {
							await this.api.chapters.update(chapterId, { volumeId });
							await this.fileManager.updateFrontmatter(lc.filePath, { volume_id: volumeId });
							lc.frontmatter.volume_id = volumeId;
						} catch (error) {
							console.error(`Failed to update volume parent for chapter ${chapterId}:`, error);
						}
					}
				}
			}
		}
	}

	/**
	 * Update settings reference
	 */
	public setSettings(settings: GrimoireSyncSettings): void {
		this.settings = settings;
	}
}
