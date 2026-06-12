import { App, TFile, TFolder, TAbstractFile, Notice, normalizePath } from "obsidian";
import type { GrimoireApi } from "../api";
import type { SyncManager } from "../sync";
import type { GrimoireSyncSettings } from "../settings";
import { joinPath, extractOrderFromName, SERIES_METADATA_FILE, VOLUME_METADATA_FILE } from "../utils";

export class VaultEventHandler {
	private fileIdMap: Map<string, { id: string; type: string }> = new Map();
	private modifyTimers: Map<string, number> = new Map();

	constructor(
		private app: App,
		private syncManager: SyncManager,
		private settings: GrimoireSyncSettings,
		private api: GrimoireApi,
		private refreshBookTreeView: () => void
	) {
		this.updateFileIdMap();
	}

	/**
	 * Scans the vault to build the mapping between local files and Grimoire entities
	 */
	public updateFileIdMap() {
		this.fileIdMap.clear();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const grimoireId = cache?.frontmatter?.["grimoire_id"];
			const type = cache?.frontmatter?.["grimoire_type"];
			if (grimoireId && type) {
				this.fileIdMap.set(file.path, { id: String(grimoireId), type: String(type) });
			}
		}
	}

	/**
	 * Handle file modification events (triggered when user edits text)
	 */
	public handleFileModify(file: TFile) {
		if (file.extension !== "md" || file.name === SERIES_METADATA_FILE || file.name === VOLUME_METADATA_FILE) return;

		const seriesFolder = this.getSeriesFolder(file.path);
		if (seriesFolder && !this.isSeriesSynced(seriesFolder)) return;

		const cache = this.app.metadataCache.getFileCache(file);
		if (cache?.frontmatter?.["grimoire_type"] !== "chapter") return;

		if (this.syncManager.fileManager.consumeProgrammatic(file.path)) {
			return;
		}

		const path = file.path;
		if (this.modifyTimers.has(path)) {
			window.clearTimeout(this.modifyTimers.get(path));
		}

		const timer = window.setTimeout(async () => {
			this.modifyTimers.delete(path);
			try {
				await this.syncManager.pushModifiedChapter(file);
				console.debug(`Automatically pushed modified chapter: ${file.name}`);
				this.refreshBookTreeView();
			} catch (err) {
				console.error(`Failed to auto-push modified chapter: ${file.name}`, err);
			}
		}, 3000); // 3 seconds debounce

		this.modifyTimers.set(path, timer);
	}

	/**
	 * Handle file creation events (manually created folders/files)
	 */
	public async handleFileCreate(file: TAbstractFile) {
		const seriesFolder = this.getSeriesFolder(file.path);
		if (seriesFolder && !this.isSeriesSynced(seriesFolder)) return;

		if (this.syncManager.fileManager.consumeProgrammatic(file.path)) {
			return;
		}

		if (file instanceof TFolder) {
			const syncFolder = this.settings.syncFolder;
			const relativePath = normalizePath(file.path);
			const syncFolderPath = normalizePath(syncFolder);

			if (relativePath === syncFolderPath) return;

			if (file.parent && normalizePath(file.parent.path) === syncFolderPath) {
				try {
					new Notice(`Creating new series on server: ${file.name}...`);
					const series = await this.api.series.create({
						title: file.name,
						metadata: { authors: [], artists: [], tags: [], description: [] }
					});
					
					const metadataPath = normalizePath(joinPath(file.path, SERIES_METADATA_FILE));
					this.syncManager.fileManager.markAsProgrammatic(metadataPath);
					await this.app.vault.create(
						metadataPath,
						`---\ngrimoire_id: ${series.id}\ngrimoire_type: series\ntitle: ${series.title}\n---\n`
					);
					new Notice(`Series "${file.name}" initialized successfully!`);
					this.refreshBookTreeView();
				} catch (err) {
					new Notice(`Failed to create series on server: ${err instanceof Error ? err.message : err}`);
				}
			}
			else if (file.parent) {
				const parentSeriesMetaPath = normalizePath(joinPath(file.parent.path, SERIES_METADATA_FILE));
				const parentSeriesMeta = this.app.vault.getAbstractFileByPath(parentSeriesMetaPath);
				if (parentSeriesMeta instanceof TFile) {
					const seriesCache = this.app.metadataCache.getFileCache(parentSeriesMeta);
					const seriesId = seriesCache?.frontmatter?.["grimoire_id"];
					if (seriesId) {
						try {
							const volumeTitle = file.name.replace(/^\d+\s*-\s*/, "");
							const volumeOrder = extractOrderFromName(file.name) ?? 0;
							
							new Notice(`Creating new volume on server: ${volumeTitle}...`);
							const volume = await this.api.volumes.create({
								seriesId: String(seriesId),
								title: volumeTitle,
								order: volumeOrder
							});

							const metadataPath = normalizePath(joinPath(file.path, VOLUME_METADATA_FILE));
							this.syncManager.fileManager.markAsProgrammatic(metadataPath);
							await this.app.vault.create(
								metadataPath,
								`---\ngrimoire_id: ${volume.id}\ngrimoire_type: volume\nseries_id: ${seriesId}\norder: ${volume.order}\ntitle: ${volume.title}\n---\n`
							);
							new Notice(`Volume "${volumeTitle}" initialized successfully!`);
							this.refreshBookTreeView();
						} catch (err) {
							new Notice(`Failed to create volume on server: ${err instanceof Error ? err.message : err}`);
						}
					}
				}
			}
		}
		else if (file instanceof TFile && file.extension === "md") {
			if (file.name === SERIES_METADATA_FILE || file.name === VOLUME_METADATA_FILE) return;

			if (file.parent) {
				const volumeMetaPath = normalizePath(joinPath(file.parent.path, VOLUME_METADATA_FILE));
				const volumeMeta = this.app.vault.getAbstractFileByPath(volumeMetaPath);
				if (volumeMeta instanceof TFile) {
					const cache = this.app.metadataCache.getFileCache(file);
					if (cache?.frontmatter?.["grimoire_id"]) return;

					const volCache = this.app.metadataCache.getFileCache(volumeMeta);
					const volumeId = volCache?.frontmatter?.["grimoire_id"];
					const seriesFolder = file.parent.parent;

					if (volumeId && seriesFolder) {
						try {
							const title = file.basename;
							const order = extractOrderFromName(file.basename) ?? 0;

							new Notice(`Creating new chapter on server: ${title}...`);
							const chapter = await this.api.chapters.create({
								volumeId: String(volumeId),
								title,
								order,
								rawContent: ""
							});
							
							const seriesTitle = seriesFolder.name;
							const volumeTitle = file.parent.name.replace(/^\d+\s*-\s*/, "");
							const volumeOrder = extractOrderFromName(file.parent.name) ?? 0;

							await this.syncManager.fileManager.writeChapterFile(
								chapter,
								seriesTitle,
								volumeTitle,
								volumeOrder,
								order
							);
							new Notice(`Chapter "${title}" initialized successfully!`);
							this.refreshBookTreeView();
						} catch (err) {
							new Notice(`Failed to create chapter on server: ${err instanceof Error ? err.message : err}`);
						}
					}
				}
			}
		}
	}

	/**
	 * Handle file deletion events
	 */
	public async handleFileDelete(file: TAbstractFile) {
		const seriesFolder = this.getSeriesFolder(file.path);
		if (seriesFolder && !this.isSeriesSynced(seriesFolder)) return;

		if (this.syncManager.fileManager.consumeProgrammatic(file.path)) {
			return;
		}

		const mapped = this.fileIdMap.get(file.path);
		if (!mapped) return;

		this.fileIdMap.delete(file.path);

		try {
			if (mapped.type === "chapter") {
				new Notice(`Deleting chapter on server...`);
				await this.api.chapters.delete(mapped.id);
				console.debug(`Deleted chapter on server: ${mapped.id}`);
			} else if (mapped.type === "volume" && file.name === VOLUME_METADATA_FILE) {
				new Notice(`Deleting volume on server...`);
				await this.api.volumes.delete(mapped.id);
				console.debug(`Deleted volume on server: ${mapped.id}`);
			} else if (mapped.type === "series" && file.name === SERIES_METADATA_FILE) {
				new Notice(`Deleting series on server...`);
				await this.api.series.delete(mapped.id);
				console.debug(`Deleted series on server: ${mapped.id}`);
			}
			this.refreshBookTreeView();
		} catch (err) {
			new Notice(`Failed to delete on server: ${err instanceof Error ? err.message : err}`);
		}
	}

	/**
	 * Handle file renaming events
	 */
	public async handleFileRename(file: TAbstractFile, oldPath: string) {
		const seriesFolder = this.getSeriesFolder(file.path);
		if (seriesFolder && !this.isSeriesSynced(seriesFolder)) return;

		if (this.syncManager.fileManager.consumeProgrammatic(file.path)) {
			return;
		}

		const mapped = this.fileIdMap.get(oldPath);
		if (mapped) {
			this.fileIdMap.delete(oldPath);
			this.fileIdMap.set(file.path, mapped);

			try {
				if (mapped.type === "chapter" && file instanceof TFile) {
					new Notice(`Renaming chapter on server...`);
					const cache = this.app.metadataCache.getFileCache(file);
					const order = Number(cache?.frontmatter?.["order"]) || 0;
					await this.api.chapters.update(mapped.id, {
						title: file.basename,
						order
					});
				} else if (mapped.type === "volume" && file instanceof TFile) {
					const volumeFolder = file.parent;
					if (volumeFolder) {
						new Notice(`Renaming volume on server...`);
						const volumeTitle = volumeFolder.name.replace(/^\d+\s*-\s*/, "");
						const volumeOrder = extractOrderFromName(volumeFolder.name) ?? 0;
						await this.api.volumes.update(mapped.id, {
							title: volumeTitle,
							order: volumeOrder
						});
					}
				} else if (mapped.type === "series" && file instanceof TFile) {
					const seriesFolder = file.parent;
					if (seriesFolder) {
						new Notice(`Renaming series on server...`);
						await this.api.series.update(mapped.id, {
							title: seriesFolder.name
						});
					}
				}
				this.refreshBookTreeView();
			} catch (err) {
				new Notice(`Failed to rename on server: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	/**
	 * Handle Obsidian frontmatter/metadata cache changed events
	 */
	public handleMetadataChanged(file: TFile) {
		if (file.extension !== "md") return;
		const cache = this.app.metadataCache.getFileCache(file);
		const grimoireId = cache?.frontmatter?.["grimoire_id"];
		const type = cache?.frontmatter?.["grimoire_type"];
		if (grimoireId && type) {
			this.fileIdMap.set(file.path, { id: String(grimoireId), type: String(type) });
		} else {
			this.fileIdMap.delete(file.path);
		}
	}

	/**
	 * Resolve the series directory name for a given file path
	 */
	public getSeriesFolder(filePath: string): string | null {
		const syncFolder = this.settings.syncFolder;
		const relativePath = normalizePath(filePath);
		const syncFolderPath = normalizePath(syncFolder);

		if (!relativePath.startsWith(syncFolderPath)) return null;

		const pathParts = relativePath.substring(syncFolderPath.length).split("/").filter(Boolean);
		return pathParts[0] || null;
	}

	/**
	 * Check if a series folder has a corresponding synced metadata file
	 */
	public isSeriesSynced(seriesFolderName: string): boolean {
		const syncFolder = this.settings.syncFolder;
		const seriesFolderPath = normalizePath(joinPath(syncFolder, seriesFolderName));
		const seriesMetadataPath = normalizePath(joinPath(seriesFolderPath, SERIES_METADATA_FILE));
		return this.app.vault.getAbstractFileByPath(seriesMetadataPath) instanceof TFile;
	}

	/**
	 * Clean up outstanding timers
	 */
	public cleanup() {
		this.modifyTimers.forEach((timer) => window.clearTimeout(timer));
		this.modifyTimers.clear();
	}
}
