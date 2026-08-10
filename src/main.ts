/**
 * Grimoire Sync - Obsidian Plugin
 * Sync ebook content (Series, Volumes, Chapters) with Grimoire backend API
 */

import { App, Menu, Modal, Notice, Plugin, Setting, TFile, TFolder, normalizePath, Workspace, TAbstractFile } from "obsidian";
import { GrimoireApi } from "./api";
import { SyncManager } from "./sync";
import { SeriesSelectionModal, SyncStatusBar, GrimoireTreeView, GRIMOIRE_TREE_VIEW, ChapterTitleModal, ImportInboxModal } from "./ui";
import { DEFAULT_SETTINGS, GrimoireSyncSettings, GrimoireSyncSettingTab } from "./settings";
import { joinPath, SERIES_METADATA_FILE, VOLUME_METADATA_FILE } from "./utils";
import { parseFrontmatter } from "./vault/frontmatter";
import type { BookTreeDto, ChapterResponse } from "./types";
import type { JobResponse } from "./types";
import { VaultEventHandler } from "./handlers/vault-event-handler";
import { ChapterOpsHandler } from "./handlers/chapter-ops-handler";

export default class GrimoireSyncPlugin extends Plugin {
	settings: GrimoireSyncSettings = DEFAULT_SETTINGS;
	public api: GrimoireApi | null = null;
	public syncManager: SyncManager | null = null;
	public vaultEventHandler: VaultEventHandler | null = null;
	public chapterOpsHandler: ChapterOpsHandler | null = null;
	private statusBar: SyncStatusBar | null = null;
	private autoSyncIntervalId: number | null = null;
	private originalGetLeavesOfType: any = null;
	private isPluginEnabled = false;
	private ribbonIconEl: HTMLElement | null = null;

	async onload() {
		this.isPluginEnabled = true;
		await this.loadSettings();

		// Initialize API client if configured
		await this.initializeApi();

		// Register Grimoire Tree View
		this.registerView(GRIMOIRE_TREE_VIEW, (leaf) => new GrimoireTreeView(leaf, this));

		// Patch Workspace.prototype.getLeavesOfType
		this.patchWorkspaceLeaves();

		// Add Ribbon Icon to toggle Book Tree
		this.ribbonIconEl = this.addRibbonIcon("folder-tree", "Open Grimoire Book Tree", () => this.initBookTreeView());

		// Register context menu for quick options on right-click of the ribbon icon
		this.ribbonIconEl.addEventListener("contextmenu", (e) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("Open Book Tree")
					.setIcon("folder-tree")
					.onClick(() => this.initBookTreeView())
			);
			menu.addItem((item) =>
				item
					.setTitle("Sync All Series")
					.setIcon("sync")
					.onClick(() => this.pullAll())
			);
			menu.addItem((item) =>
				item
					.setTitle("Open Settings")
					.setIcon("settings")
					.onClick(() => {
						try {
							(this.app as any).setting.open();
							(this.app as any).setting.openTabById("grimoire-sync");
						} catch {
							new Notice("Failed to open settings tab");
						}
					})
			);
			menu.showAtMouseEvent(e);
		});

		// Move ribbon icon to the top if parent is already attached
		this.arrangeRibbonIcon();

		// Add status bar item
		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new SyncStatusBar(statusBarEl);

		// Register commands
		this.registerCommands();

		// Register context menus
		this.registerContextMenus();

		// Add settings tab
		this.addSettingTab(new GrimoireSyncSettingTab(this.app, this));

		// Register auto-sync file system events
		this.registerEvent(this.app.vault.on("create", (file) => this.vaultEventHandler?.handleFileCreate(file)));
		this.registerEvent(this.app.vault.on("modify", (file) => {
			if (file instanceof TFile) {
				this.vaultEventHandler?.handleFileModify(file);
			}
		}));
		this.registerEvent(this.app.vault.on("delete", (file) => this.vaultEventHandler?.handleFileDelete(file)));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.vaultEventHandler?.handleFileRename(file, oldPath)));
		this.registerEvent(this.app.metadataCache.on("changed", (file) => this.vaultEventHandler?.handleMetadataChanged(file)));

		// Watch layout changes to replace new file-explorers with Grimoire Tree View
		this.registerEvent(this.app.workspace.on("layout-change", () => {
			if (this.isPluginEnabled) {
				this.replaceFileExplorerLeafs();
			}
		}));

		// Start auto sync after layout ready
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.syncOnStartup) {
				this.pullAll();
			}
			this.startAutoSyncTimer();

			// Replace standard file-explorer leaf with Grimoire Tree View
			this.replaceFileExplorerLeafs();

			// Populate fileIdMap for deleted file lookups
			this.vaultEventHandler?.updateFileIdMap();

			// Make sure our ribbon icon is at the very top of the ribbon
			this.arrangeRibbonIcon();
		});

		console.log("Grimoire Sync plugin loaded");
	}

	onunload() {
		this.isPluginEnabled = false;
		this.stopAutoSyncTimer();

		// Clean up auto-sync modify timers
		this.vaultEventHandler?.cleanup();

		// Restore Workspace.prototype.getLeavesOfType
		if (this.originalGetLeavesOfType) {
			Workspace.prototype.getLeavesOfType = this.originalGetLeavesOfType;
		}

		// Restore standard file-explorer leaves
		this.restoreFileExplorerLeafs();

		console.log("Grimoire Sync plugin unloaded");
	}

	async initBookTreeView() {
		let leaf = this.app.workspace.getLeavesOfType(GRIMOIRE_TREE_VIEW)[0];
		if (!leaf) {
			const leftLeaf = this.app.workspace.getLeftLeaf(false);
			if (leftLeaf) {
				leaf = leftLeaf;
				await leaf.setViewState({ type: GRIMOIRE_TREE_VIEW, active: true });
			}
		}
		if (leaf) {
			this.app.workspace.revealLeaf(leaf);
		}
	}

	private arrangeRibbonIcon() {
		if (this.ribbonIconEl && this.ribbonIconEl.parentElement) {
			this.ribbonIconEl.parentElement.prepend(this.ribbonIconEl);
		}
	}

	private patchWorkspaceLeaves() {
		const original = Workspace.prototype.getLeavesOfType;
		this.originalGetLeavesOfType = original;
		const self = this;
		Workspace.prototype.getLeavesOfType = function (type: string) {
			if (type === "file-explorer" && self.isPluginEnabled) {
				return original.call(this, GRIMOIRE_TREE_VIEW);
			}
			return original.call(this, type);
		};
	}

	private replaceFileExplorerLeafs() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view && leaf.view.getViewType() === "file-explorer") {
				leaf.setViewState({
					type: GRIMOIRE_TREE_VIEW,
					active: true
				});
			}
		});
	}

	private restoreFileExplorerLeafs() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view && leaf.view.getViewType() === GRIMOIRE_TREE_VIEW) {
				leaf.setViewState({
					type: "file-explorer",
					active: true
				});
			}
		});
	}

	/**
	 * Initialize or reinitialize the API client
	 */
	private async initializeApi() {
		if (this.settings.apiBaseUrl) {
			this.api = new GrimoireApi({ baseUrl: this.settings.apiBaseUrl });
			this.syncManager = new SyncManager(this.app, this.api, this.settings);
			await this.syncManager.initialize();
			this.vaultEventHandler = new VaultEventHandler(
				this.app,
				this.syncManager,
				this.settings,
				this.api,
				() => this.refreshBookTreeView()
			);
			this.chapterOpsHandler = new ChapterOpsHandler(
				this.app,
				this.syncManager,
				this.api,
				this.settings,
				() => this.refreshBookTreeView()
			);
		} else {
			this.api = null;
			this.syncManager = null;
			this.vaultEventHandler = null;
			this.chapterOpsHandler = null;
		}
	}

	/**
	 * Register plugin commands
	 */
	private registerCommands() {
		// Pull all series -> Sync all series
		this.addCommand({
			id: "pull-all",
			name: "Sync all series with Grimoire",
			callback: () => this.pullAll(),
		});

		// Pull specific series -> Sync specific series
		this.addCommand({
			id: "pull-series",
			name: "Sync a specific series with Grimoire",
			callback: () => this.pullSeriesWithModal(),
		});

		// Push staged EPUBs
		this.addCommand({
			id: "push-staged-epubs",
			name: "Push EPUB files from stagings folder",
			callback: () => this.pushStagedEpubs(),
		});

		// Open book tree view
		this.addCommand({
			id: "open-book-tree",
			name: "Open Grimoire Book Tree",
			callback: () => this.initBookTreeView(),
		});

		this.addCommand({
			id: "open-import-inbox",
			name: "Open import inbox",
			callback: () => new ImportInboxModal(this).open(),
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
			this.syncManager.configure(this.settings);
		}
		this.startAutoSyncTimer();
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

		try {
			const result = await this.syncManager!.pullAll((progress) => {
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
				const message = `Sync completed: Pulled ${result.pulled?.series || 0} series, ${result.pulled?.volumes || 0} volumes, ${result.pulled?.chapters || 0} chapters. Pushed ${result.pushed?.series || 0} series, ${result.pushed?.volumes || 0} volumes, ${result.pushed?.chapters || 0} chapters.`;
				new Notice(message);
			} else {
				new Notice(`Sync failed: ${result.errors[0]}`);
			}

			this.statusBar?.update(this.syncManager!.getState());
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
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

		try {
			new Notice(`Syncing series: ${seriesTitle}`);

			const result = await this.syncManager!.pullSeries(seriesId, (progress) => {
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
				const message = `Sync completed: Pulled ${result.pulled?.volumes || 0} volumes, ${result.pulled?.chapters || 0} chapters. Pushed ${result.pushed?.volumes || 0} volumes, ${result.pushed?.chapters || 0} chapters.`;
				new Notice(`${seriesTitle}: ${message}`);
			} else {
				new Notice(`Failed to sync ${seriesTitle}: ${result.errors[0]}`);
			}

			this.statusBar?.update(this.syncManager!.getState());
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
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

	startAutoSyncTimer() {
		this.stopAutoSyncTimer();
		if (!this.settings.enableAutoSync || this.settings.syncIntervalMinutes <= 0) {
			return;
		}

		const intervalMs = this.settings.syncIntervalMinutes * 60 * 1000;
		const timerId = window.setInterval(async () => {
			if (this.api && this.syncManager && !this.syncManager.isSyncing()) {
				console.debug("Starting periodic auto-sync...");
				try {
					await this.pullAll();
				} catch (error) {
					console.error("Auto-sync failed:", error);
				}
			}
		}, intervalMs);

		this.autoSyncIntervalId = timerId;
		this.registerInterval(timerId);
	}

	stopAutoSyncTimer() {
		if (this.autoSyncIntervalId !== null) {
			window.clearInterval(this.autoSyncIntervalId);
			this.autoSyncIntervalId = null;
		}
	}

	/**
	 * Register editor and file explorer context menus
	 */
	private registerContextMenus() {
		// File explorer context menu for merging chapters
		this.registerEvent(
			this.app.workspace.on("files-menu", (menu, files) => {
				const chapterFiles = files.filter(
					(f) => f instanceof TFile && f.extension === "md" && this.app.metadataCache.getFileCache(f)?.frontmatter?.["grimoire_type"] === "chapter"
				) as TFile[];

				if (chapterFiles.length >= 2) {
					menu.addItem((item) => {
						item
							.setTitle("Merge chapters")
							.setIcon("merge")
							.onClick(async () => {
								await this.chapterOpsHandler?.mergeChapters(chapterFiles);
							});
					});
				}
			})
		);

		// Editor context menu for splitting chapters
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				const file = view.file;
				if (!file || file.extension !== "md" || this.app.metadataCache.getFileCache(file)?.frontmatter?.["grimoire_type"] !== "chapter") return;

				menu.addItem((item) => {
					item
						.setTitle("Split chapter here")
						.setIcon("split")
						.onClick(async () => {
							const cursor = editor.getCursor();
							await this.chapterOpsHandler?.splitChapter(file, cursor.line);
						});
				});
			})
		);
	}



	/**
	 * Scan Stagings folder and upload any EPUB files found
	 */
	async pushStagedEpubs() {
		if (!this.ensureApiConfigured()) return;

		const stagingsFolder = this.app.vault.getAbstractFileByPath("Stagings");
		if (!stagingsFolder || !(stagingsFolder instanceof TFolder)) {
			new Notice("Stagings folder not found in vault");
			return;
		}

		const files: TFile[] = [];
		this.getEpubFiles(stagingsFolder, files);

		if (files.length === 0) {
			new Notice("No EPUB files found in Stagings folder");
			return;
		}

		new Notice(`Found ${files.length} EPUB file(s) in Stagings folder. Starting upload...`);

		for (const file of files) {
			try {
				new Notice(`Uploading ${file.name}...`);
				const fileBuffer = await this.app.vault.readBinary(file);
				
				const title = file.basename;
				const seriesMetadata = {
					title: title,
					metadata: {
						authors: [],
						artists: [],
						tags: [],
						description: []
					}
				};

				const job = await this.api!.bindery.importBook(seriesMetadata, fileBuffer, file.name);
				new Notice(`Import queued for ${file.name} (Job ID: ${job.jobId})`);
				const completed = await this.waitForImportJob(job.jobId);
				if (completed.status.toLowerCase() === "completed") {
					await this.moveStagedFile(file, "Processed");
					new Notice(`Imported ${file.name}; moved source to Processed.`);
				} else {
					await this.moveStagedFile(file, "Failed");
					new Notice(`Import failed for ${file.name}: ${completed.error ?? "Unknown backend error"}`);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				new Notice(`Import status is uncertain for ${file.name}; file remains in Stagings: ${message}`);
			}
		}
	}

	private async waitForImportJob(jobId: string, timeoutMs = 10 * 60_000): Promise<JobResponse> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const status = await this.api!.jobs.get(jobId);
			const normalized = status.status.toLowerCase();
			if (normalized === "completed" || normalized === "failed") return status;
			await new Promise(resolve => window.setTimeout(resolve, 1_000));
		}
		throw new Error(`Timed out waiting for import job ${jobId}`);
	}

	private async moveStagedFile(file: TFile, destination: "Processed" | "Failed"): Promise<void> {
		const folderPath = normalizePath(destination);
		if (!this.app.vault.getAbstractFileByPath(folderPath)) await this.app.vault.createFolder(folderPath);
		let target = normalizePath(`${folderPath}/${file.name}`);
		if (this.app.vault.getAbstractFileByPath(target)) {
			target = normalizePath(`${folderPath}/${file.basename}-${Date.now()}.${file.extension}`);
		}
		await this.app.vault.rename(file, target);
	}

	refreshBookTreeView() {
		const leaves = this.app.workspace.getLeavesOfType(GRIMOIRE_TREE_VIEW);
		for (const leaf of leaves) {
			if (leaf.view instanceof GrimoireTreeView) {
				leaf.view.refreshView();
			}
		}
	}

	private getEpubFiles(folder: TFolder, files: TFile[]): TFile[] {
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension.toLowerCase() === "epub") {
				files.push(child);
			} else if (child instanceof TFolder) {
				this.getEpubFiles(child, files);
			}
		}
		return files;
	}



	/**
	 * Returns false when a series has been explicitly desynced
	 * (grimoire_synced: false in _series.md). Defaults to true.
	 */
	public isSeriesSynced(seriesFolder: TFolder): boolean {
		return this.vaultEventHandler?.isSeriesSynced(seriesFolder.name) ?? true;
	}

	/**
	 * Toggle sync state of a series by updating _series.md frontmatter.
	 */
	public async toggleSeriesSync(seriesFolder: TFolder): Promise<void> {
		if (!this.syncManager) return;
		const currentlySynced = this.isSeriesSynced(seriesFolder);
		const metaPath = normalizePath(joinPath(seriesFolder.path, SERIES_METADATA_FILE));
		await this.syncManager.fileManager.updateFrontmatter(metaPath, {
			grimoire_synced: !currentlySynced,
		});
		const label = currentlySynced ? "desynced" : "synced";
		new Notice(`Series "${seriesFolder.name}" ${label} from Grimoire.`);
		this.refreshBookTreeView();
	}


}
