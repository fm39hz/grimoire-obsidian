/**
 * Sync manager - Orchestrates sync operations
 */

import { App, Notice } from "obsidian";
import type { GrimoireApi } from "../api";
import { FileManager, VaultStructure } from "../vault";
import { PullSync, PullProgress } from "./pull";
import type { SyncResult, SyncState, SeriesResponse } from "../types";

export class SyncManager {
	private api: GrimoireApi;
	private fileManager: FileManager;
	private structure: VaultStructure;
	private pullSync: PullSync;
	private state: SyncState;

	constructor(app: App, api: GrimoireApi, syncFolder: string) {
		this.api = api;
		this.structure = new VaultStructure(app, syncFolder);
		this.fileManager = new FileManager(app, this.structure, api);
		this.pullSync = new PullSync(api, this.fileManager, this.structure);
		this.state = { status: "idle" };
	}

	/**
	 * Update configuration
	 */
	configure(syncFolder: string): void {
		this.structure.setSyncFolder(syncFolder);
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
			const result = await this.pullSync.pullAllSeries((progress) => {
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
			const result = await this.pullSync.pullSeries(seriesId, (progress) => {
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
}
