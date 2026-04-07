/**
 * Grimoire Sync - Obsidian Plugin
 * Sync ebook content (Series, Volumes, Chapters) with Grimoire backend API
 */

import { Notice, Plugin } from "obsidian";
import { GrimoireApi } from "./api";
import { SyncManager } from "./sync";
import { SeriesSelectionModal, SyncProgressModal, SyncStatusBar } from "./ui";
import { DEFAULT_SETTINGS, GrimoireSyncSettings, GrimoireSyncSettingTab } from "./settings";

export default class GrimoireSyncPlugin extends Plugin {
	settings: GrimoireSyncSettings = DEFAULT_SETTINGS;
	private api: GrimoireApi | null = null;
	private syncManager: SyncManager | null = null;
	private statusBar: SyncStatusBar | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize API client if configured
		this.initializeApi();

		// Add status bar item
		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new SyncStatusBar(statusBarEl);

		// Register commands
		this.registerCommands();

		// Add settings tab
		this.addSettingTab(new GrimoireSyncSettingTab(this.app, this));

		console.log("Grimoire Sync plugin loaded");
	}

	onunload() {
		console.log("Grimoire Sync plugin unloaded");
	}

	/**
	 * Initialize or reinitialize the API client
	 */
	private initializeApi() {
		if (this.settings.apiBaseUrl) {
			this.api = new GrimoireApi({ baseUrl: this.settings.apiBaseUrl });
			this.syncManager = new SyncManager(this.app, this.api, this.settings.syncFolder);
		} else {
			this.api = null;
			this.syncManager = null;
		}
	}

	/**
	 * Register plugin commands
	 */
	private registerCommands() {
		// Pull all series
		this.addCommand({
			id: "pull-all",
			name: "Pull all series from Grimoire",
			callback: () => this.pullAll(),
		});

		// Pull specific series
		this.addCommand({
			id: "pull-series",
			name: "Pull a specific series from Grimoire",
			callback: () => this.pullSeriesWithModal(),
		});
	}

	/**
	 * Load plugin settings
	 */
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * Save plugin settings
	 */
	async saveSettings() {
		await this.saveData(this.settings);
		// Reinitialize API with new settings
		this.initializeApi();
		if (this.syncManager) {
			this.syncManager.configure(this.settings.syncFolder);
		}
	}

	/**
	 * Test connection to the API
	 */
	async testConnection(): Promise<void> {
		if (!this.api || !this.syncManager) {
			new Notice("Please configure the API URL first");
			throw new Error("API not configured");
		}

		const success = await this.syncManager.testConnection();
		if (success) {
			new Notice("Connection successful!");
		} else {
			new Notice("Connection failed. Please check the API URL.");
			throw new Error("Connection failed");
		}
	}

	/**
	 * Pull all series from the API
	 */
	async pullAll() {
		if (!this.ensureApiConfigured()) return;

		const progressModal = new SyncProgressModal(this.app);
		progressModal.open();

		try {
			const result = await this.syncManager!.pullAll((progress) => {
				progressModal.updateProgress(progress);
				this.statusBar?.update({
					status: "pulling",
					progress: {
						current: progress.current,
						total: progress.total,
						message: progress.message,
					},
				});
			});

			if (result.success) {
				const message = `Pulled ${result.pulled?.series || 0} series, ${result.pulled?.volumes || 0} volumes, ${result.pulled?.chapters || 0} chapters`;
				progressModal.showComplete(true, message);
				new Notice(message);
			} else {
				const errorMsg = result.errors.slice(0, 3).join("\n");
				progressModal.showComplete(false, errorMsg);
				new Notice(`Sync failed: ${result.errors[0]}`);
			}

			this.statusBar?.update(this.syncManager!.getState());
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			progressModal.showComplete(false, message);
			new Notice(`Sync error: ${message}`);
			this.statusBar?.update({ status: "error", error: message });
		}
	}

	/**
	 * Show modal to select a series and pull it
	 */
	private async pullSeriesWithModal() {
		if (!this.ensureApiConfigured()) return;

		try {
			new Notice("Fetching series list...");
			const seriesList = await this.syncManager!.getSeriesList();

			const modal = new SeriesSelectionModal(this.app, seriesList, async (selected) => {
				if (!selected) return;

				if (selected.id === "__ALL__") {
					// Pull all series
					await this.pullAll();
				} else if (selected.id) {
					// Pull specific series
					await this.pullSingleSeries(selected.id, selected.title || "Unknown");
				}
			});

			modal.open();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			new Notice(`Failed to fetch series: ${message}`);
		}
	}

	/**
	 * Pull a single series by ID
	 */
	private async pullSingleSeries(seriesId: string, seriesTitle: string) {
		if (!this.ensureApiConfigured()) return;

		const progressModal = new SyncProgressModal(this.app);
		progressModal.open();

		try {
			new Notice(`Pulling series: ${seriesTitle}`);

			const result = await this.syncManager!.pullSeries(seriesId, (progress) => {
				progressModal.updateProgress(progress);
				this.statusBar?.update({
					status: "pulling",
					progress: {
						current: progress.current,
						total: progress.total,
						message: progress.message,
					},
				});
			});

			if (result.success) {
				const message = `Pulled ${result.pulled?.volumes || 0} volumes, ${result.pulled?.chapters || 0} chapters`;
				progressModal.showComplete(true, message);
				new Notice(`${seriesTitle}: ${message}`);
			} else {
				const errorMsg = result.errors.slice(0, 3).join("\n");
				progressModal.showComplete(false, errorMsg);
				new Notice(`Failed to pull ${seriesTitle}: ${result.errors[0]}`);
			}

			this.statusBar?.update(this.syncManager!.getState());
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			progressModal.showComplete(false, message);
			new Notice(`Sync error: ${message}`);
			this.statusBar?.update({ status: "error", error: message });
		}
	}

	/**
	 * Check if API is configured and show notice if not
	 */
	private ensureApiConfigured(): boolean {
		if (!this.api || !this.syncManager) {
			new Notice("Please configure the Grimoire API URL in settings first");
			return false;
		}
		return true;
	}
}
