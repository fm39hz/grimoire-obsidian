import { App, Notice, TFile, normalizePath } from "obsidian";
import type { GrimoireApi } from "../api";
import { FileManager, VaultStructure } from "../vault";
import { BidirectionalSync, PullProgress } from "./bidirectional-sync";
import type { SyncResult, SyncState, SeriesResponse } from "../types";
import type { GrimoireSyncSettings } from "../settings";
import { joinPath, extractOrderFromName, VOLUME_METADATA_FILE } from "../utils";

export class SyncManager {
	private api: GrimoireApi;
	public fileManager: FileManager;
	public structure: VaultStructure;
	public bidirectionalSync: BidirectionalSync;
	private state: SyncState;
	private settings: GrimoireSyncSettings;

	constructor(private app: App, api: GrimoireApi, settings: GrimoireSyncSettings) {
		this.api = api;
		this.settings = settings;
		this.structure = new VaultStructure(app, settings.syncFolder, settings.imagesFolder);
		this.fileManager = new FileManager(app, this.structure, api, settings);
		this.bidirectionalSync = new BidirectionalSync(api, this.fileManager, this.structure, app, settings);
		this.state = { status: "idle" };
	}

	/**
	 * Update configuration
	 */
	configure(settings: GrimoireSyncSettings): void {
		this.settings = settings;
		this.structure.setSyncFolder(settings.syncFolder);
		this.structure.setImagesFolder(settings.imagesFolder);
		this.fileManager.setSettings(settings);
		this.bidirectionalSync.setSettings(settings);
	}

	/**
	 * Get current sync state
	 */
	getState(): SyncState {
		return { ...this.state };
	}

	/**
	 * Check if currently syncing
	 */
	isSyncing(): boolean {
		return this.state.status === "pulling" || this.state.status === "pushing";
	}

	/**
	 * Test connection to the API
	 */
	async testConnection(): Promise<boolean> {
		try {
			// Try to fetch series list as a simple health check
			await this.api.series.list({ pageSize: 1 });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get list of all series from API
	 */
	async getSeriesList(): Promise<SeriesResponse[]> {
		return this.api.series.listAll();
	}

	/**
	 * Pull all series from the API
	 */
	async pullAll(onProgress?: (progress: PullProgress) => void): Promise<SyncResult> {
		if (this.isSyncing()) {
			return {
				success: false,
				errors: ["Sync already in progress"],
			};
		}

		this.state = {
			status: "pulling",
			progress: { current: 0, total: 0, message: "Starting pull..." },
		};

		try {
			const result = await this.bidirectionalSync.pullAllSeries((progress) => {
				this.state.progress = {
					current: progress.current,
					total: progress.total,
					message: progress.message,
				};
				onProgress?.(progress);
			});

			this.state = {
				status: result.success ? "idle" : "error",
				lastSync: result.success ? new Date().toISOString() : this.state.lastSync,
				error: result.success ? undefined : result.errors.join("; "),
			};

			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			this.state = {
				status: "error",
				error: message,
			};
			return {
				success: false,
				errors: [message],
			};
		}
	}

	/**
	 * Pull a specific series by ID
	 */
	async pullSeries(seriesId: string, onProgress?: (progress: PullProgress) => void): Promise<SyncResult> {
		if (this.isSyncing()) {
			return {
				success: false,
				errors: ["Sync already in progress"],
			};
		}

		this.state = {
			status: "pulling",
			progress: { current: 0, total: 0, message: "Starting pull..." },
		};

		try {
			const result = await this.bidirectionalSync.pullSeries(seriesId, (progress) => {
				this.state.progress = {
					current: progress.current,
					total: progress.total,
					message: progress.message,
				};
				onProgress?.(progress);
			});

			this.state = {
				status: result.success ? "idle" : "error",
				lastSync: result.success ? new Date().toISOString() : this.state.lastSync,
				error: result.success ? undefined : result.errors.join("; "),
			};

			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			this.state = {
				status: "error",
				error: message,
			};
			return {
				success: false,
				errors: [message],
			};
		}
	}

	/**
	 * Get local series information
	 */
	async getLocalSeries() {
		return this.structure.findAllSeries();
	}

	/**
	 * Check if file was modified locally since last sync
	 */
	public isLocallyModified(file: TFile): boolean {
		return this.bidirectionalSync.isLocallyModified(file);
	}

	/**
	 * Mark a path as programmatically written so event handlers can ignore the next change event
	 */
	public markPathAsProgrammatic(path: string): void {
		this.fileManager.markAsProgrammatic(path);
	}

	/**
	 * Get chapter sync context for a file
	 */
	public getChapterSyncContext(file: TFile) {
		const volumeFolder = file.parent;
		if (!volumeFolder) return null;
		
		const seriesFolder = volumeFolder.parent;
		if (!seriesFolder) return null;

		const volumeMetadataPath = normalizePath(joinPath(volumeFolder.path, VOLUME_METADATA_FILE));
		const volumeMetadataFile = this.app.vault.getAbstractFileByPath(volumeMetadataPath);
		if (!(volumeMetadataFile instanceof TFile)) return null;

		const volCache = this.app.metadataCache.getFileCache(volumeMetadataFile);
		const volumeId = volCache?.frontmatter?.["grimoire_id"];
		if (!volumeId) return null;

		const volumeTitle = volumeFolder.name.replace(/^\d+\s*-\s*/, "");
		const volumeOrder = extractOrderFromName(volumeFolder.name) ?? 0;
		const seriesTitle = seriesFolder.name;

		return {
			volumeId: String(volumeId),
			volumeTitle,
			volumeOrder,
			seriesTitle
		};
	}

	/**
	 * Push a modified chapter to the server
	 */
	public async pushModifiedChapter(file: TFile): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(file);
		const grimoireId = cache?.frontmatter?.["grimoire_id"];
		const type = cache?.frontmatter?.["grimoire_type"];
		if (type !== "chapter" || !grimoireId) return;

		const ctx = this.getChapterSyncContext(file);
		if (!ctx) return;

		const order = Number(cache?.frontmatter?.["order"]) || 0;
		const title = cache?.frontmatter?.["title"] || file.basename;

		await this.bidirectionalSync.pushChapter(
			file,
			{ id: String(grimoireId), title, order },
			ctx.volumeId,
			ctx.seriesTitle,
			ctx.volumeTitle,
			ctx.volumeOrder,
			order,
			true // skipWrite = true
		);
	}
}
