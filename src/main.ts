/**
 * Grimoire Sync - Obsidian Plugin
 * Sync ebook content (Series, Volumes, Chapters) with Grimoire backend API
 */

import { App, Menu, Modal, Notice, Plugin, Setting, TFile, TFolder, normalizePath, Workspace } from "obsidian";
import { GrimoireApi } from "./api";
import { SyncManager } from "./sync";
import { SeriesSelectionModal, SyncStatusBar, GrimoireTreeView, GRIMOIRE_TREE_VIEW } from "./ui";
import { DEFAULT_SETTINGS, GrimoireSyncSettings, GrimoireSyncSettingTab } from "./settings";
import { extractOrderFromName, joinPath } from "./utils";
import type { BookTreeDto, ChapterResponse } from "./types";

export default class GrimoireSyncPlugin extends Plugin {
	settings: GrimoireSyncSettings = DEFAULT_SETTINGS;
	public api: GrimoireApi | null = null;
	public syncManager: SyncManager | null = null;
	private statusBar: SyncStatusBar | null = null;
	private autoSyncIntervalId: number | null = null;
	private originalGetLeavesOfType: any = null;

	async onload() {
		await this.loadSettings();

		// Initialize API client if configured
		this.initializeApi();

		// Register Grimoire Tree View
		this.registerView(GRIMOIRE_TREE_VIEW, (leaf) => new GrimoireTreeView(leaf, this));

		// Patch Workspace.prototype.getLeavesOfType
		this.patchWorkspaceLeaves();

		// Add Ribbon Icon to toggle Book Tree
		this.addRibbonIcon("folder-tree", "Open Grimoire Book Tree", () => this.initBookTreeView());

		// Add status bar item
		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new SyncStatusBar(statusBarEl);

		// Register commands
		this.registerCommands();

		// Register context menus
		this.registerContextMenus();

		// Add settings tab
		this.addSettingTab(new GrimoireSyncSettingTab(this.app, this));

		// Start auto sync after layout ready
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.syncOnStartup) {
				this.pullAll();
			}
			this.startAutoSyncTimer();

			// Replace standard file-explorer leaf with Grimoire Tree View
			this.replaceFileExplorerLeafs();
		});

		console.log("Grimoire Sync plugin loaded");
	}

	onunload() {
		this.stopAutoSyncTimer();

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

	private patchWorkspaceLeaves() {
		const original = Workspace.prototype.getLeavesOfType;
		this.originalGetLeavesOfType = original;
		const self = this;
		Workspace.prototype.getLeavesOfType = function (type: string) {
			if (type === "file-explorer") {
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
	private initializeApi() {
		if (this.settings.apiBaseUrl) {
			this.api = new GrimoireApi({ baseUrl: this.settings.apiBaseUrl });
			this.syncManager = new SyncManager(this.app, this.api, this.settings);
		} else {
			this.api = null;
			this.syncManager = null;
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
					(f) => f instanceof TFile && f.extension === "md" && this.isChapterFile(f)
				) as TFile[];

				if (chapterFiles.length >= 2) {
					menu.addItem((item) => {
						item
							.setTitle("Merge chapters")
							.setIcon("merge")
							.onClick(async () => {
								await this.mergeChapters(chapterFiles);
							});
					});
				}
			})
		);

		// Editor context menu for splitting chapters
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				const file = view.file;
				if (!file || file.extension !== "md" || !this.isChapterFile(file)) return;

				menu.addItem((item) => {
					item
						.setTitle("Split chapter here")
						.setIcon("split")
						.onClick(async () => {
							const cursor = editor.getCursor();
							await this.splitChapter(file, cursor.line);
						});
				});
			})
		);
	}

	private isChapterFile(file: TFile): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter?.["grimoire_type"] === "chapter";
	}

	private async mergeChapters(chapterFiles: TFile[]) {
		if (!this.api || !this.syncManager) {
			new Notice("Grimoire API is not configured");
			return;
		}

		const sortedFiles = chapterFiles.map(file => {
			const cache = this.app.metadataCache.getFileCache(file);
			const order = Number(cache?.frontmatter?.["order"]) || 0;
			const grimoireId = String(cache?.frontmatter?.["grimoire_id"] || "");
			return { file, order, grimoireId };
		}).sort((a, b) => a.order - b.order);

		const chapterIds = sortedFiles.map(f => f.grimoireId).filter(Boolean);
		if (chapterIds.length < 2) {
			new Notice("No valid Grimoire IDs found to merge");
			return;
		}

		new Notice("Merging chapters...");

		try {
			const referenceFile = sortedFiles[0]!.file;
			if (referenceFile.parent && referenceFile.parent.parent) {
				const volumeFolder = referenceFile.parent;
				const seriesFolder = referenceFile.parent.parent;

				const volumeMetadataPath = normalizePath(joinPath(volumeFolder.path, "_volume.md"));
				const volumeMetadataFile = this.app.vault.getAbstractFileByPath(volumeMetadataPath);
				if (volumeMetadataFile instanceof TFile) {
					const volCache = this.app.metadataCache.getFileCache(volumeMetadataFile);
					const volumeIdPrefixed = volCache?.frontmatter?.["grimoire_id"];
					if (volumeIdPrefixed) {
						const volumeId = String(volumeIdPrefixed);
						const seriesTitle = seriesFolder.name;
						const volumeTitle = volumeFolder.name.replace(/^\d+\s*-\s*/, "");
						const volumeOrder = extractOrderFromName(volumeFolder.name) ?? 0;

						// Save local changes to server only if they are modified
						for (const sf of sortedFiles) {
							if (this.syncManager.pullSync.isLocallyModified(sf.file)) {
								new Notice(`Saving local changes for ${sf.file.name}...`);
								const displayOrder = extractOrderFromName(sf.file.basename) ?? 0;
								await this.syncManager.pullSync.pushChapter(
									sf.file,
									{ id: sf.grimoireId, title: sf.file.basename, order: sf.order },
									volumeId,
									seriesTitle,
									volumeTitle,
									volumeOrder,
									displayOrder,
									true // skipWrite
								);
							}
						}

						const mergedChapter = await this.api.chapters.merge({ chapterIds });
						new Notice("Chapters merged successfully on server!");

						// Trash the old files first
						for (const sf of sortedFiles) {
							const oldFile = this.app.vault.getAbstractFileByPath(sf.file.path);
							if (oldFile instanceof TFile) {
								await this.app.fileManager.trashFile(oldFile);
							}
						}

						// Write the merged chapter file using returned markdown content directly
						await this.syncManager.fileManager.writeChapterFile(mergedChapter, seriesTitle, volumeTitle, volumeOrder, mergedChapter.order);

						// Refresh the Grimoire tree view
						this.refreshBookTreeView();

						new Notice(`Merged successfully!`);
					}
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			new Notice(`Failed to merge chapters: ${message}`);
		}
	}

	private async splitChapter(file: TFile, cursorLine: number) {
		if (!this.api || !this.syncManager) {
			new Notice("Grimoire API is not configured");
			return;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		const chapterId = String(cache?.frontmatter?.["grimoire_id"] || "");
		if (!chapterId) {
			new Notice("No valid Grimoire ID found for this chapter");
			return;
		}

		const fileContent = await this.app.vault.read(file);
		const segmentIndex = this.getSegmentIndexAtCursor(fileContent, cursorLine);

		let defaultTitle = this.getSegmentTextAtCursor(fileContent, cursorLine);
		// Clean up markdown heading prefix
		defaultTitle = defaultTitle.replace(/^#+\s+/, "");
		// Truncate to a reasonable length if too long
		if (defaultTitle.length > 100) {
			defaultTitle = defaultTitle.substring(0, 100) + "...";
		}
		if (!defaultTitle) {
			defaultTitle = `${file.basename} (Part 2)`;
		}

		const modal = new ChapterTitleModal(this.app, defaultTitle, async (newTitle) => {
			new Notice("Splitting chapter...");
			try {
				if (file.parent && file.parent.parent) {
					const volumeFolder = file.parent;
					const seriesFolder = file.parent.parent;

					const volumeMetadataPath = normalizePath(joinPath(volumeFolder.path, "_volume.md"));
					const volumeMetadataFile = this.app.vault.getAbstractFileByPath(volumeMetadataPath);
					if (volumeMetadataFile instanceof TFile) {
						const volCache = this.app.metadataCache.getFileCache(volumeMetadataFile);
						const volumeIdPrefixed = volCache?.frontmatter?.["grimoire_id"];
						if (volumeIdPrefixed) {
							const volumeId = String(volumeIdPrefixed);
							const seriesTitle = seriesFolder.name;
							const volumeTitle = volumeFolder.name.replace(/^\d+\s*-\s*/, "");
							const volumeOrder = extractOrderFromName(volumeFolder.name) ?? 0;
							const displayOrder = extractOrderFromName(file.basename) ?? 0;

							// Save local changes to server only if modified
							if (this.syncManager!.pullSync.isLocallyModified(file)) {
								new Notice("Saving local changes to server...");
								await this.syncManager!.pullSync.pushChapter(
									file,
									{
										id: chapterId,
										title: cache?.frontmatter?.["title"] || file.basename,
										order: Number(cache?.frontmatter?.["order"]) || 0
									},
									volumeId,
									seriesTitle,
									volumeTitle,
									volumeOrder,
									displayOrder,
									true // skipWrite
								);
							}

							const resultChapters = await this.api!.chapters.split(chapterId, {
								splitPoints: [{ segmentIndex, newChapterTitle: newTitle }]
							});

							new Notice("Chapter split successfully on server!");

							// Trash the old original file first to prevent duplicate filename issues
							const oldFile = this.app.vault.getAbstractFileByPath(file.path);
							if (oldFile instanceof TFile) {
								await this.app.fileManager.trashFile(oldFile);
							}

							// Write the newly split chapters (original + new ones) using returned markdown content directly
							for (const rc of resultChapters) {
								if (!rc.id) continue;
								await this.syncManager!.fileManager.writeChapterFile(rc, seriesTitle, volumeTitle, volumeOrder, rc.order);
							}

							// Refresh the Grimoire tree view
							this.refreshBookTreeView();

							new Notice("Split into chapters successfully!");
						}
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				new Notice(`Failed to split chapter: ${message}`);
			}
		});
		modal.open();
	}

	private getSegmentTextAtCursor(markdown: string, cursorLine: number): string {
		const normalized = markdown.replace(/\r\n/g, "\n");
		const lines = normalized.split("\n");
		let frontmatterLineCount = 0;
		if (normalized.startsWith("---")) {
			const nextSeparator = lines.indexOf("---", 1);
			if (nextSeparator !== -1) {
				frontmatterLineCount = nextSeparator + 1;
			}
		}

		const bodyLineIndex = cursorLine - frontmatterLineCount;
		if (bodyLineIndex < 0) return "";

		const bodyLines = lines.slice(frontmatterLineCount);
		
		// Find the start and end of the block containing bodyLineIndex
		let start = bodyLineIndex;
		while (start > 0 && (bodyLines[start - 1]?.trim() ?? "") !== "") {
			start--;
		}
		let end = bodyLineIndex;
		while (end < bodyLines.length - 1 && (bodyLines[end + 1]?.trim() ?? "") !== "") {
			end++;
		}

		const blockLines = bodyLines.slice(start, end + 1);
		return blockLines.join(" ").trim();
	}

	private getSegmentIndexAtCursor(markdown: string, cursorLine: number): number {
		const normalized = markdown.replace(/\r\n/g, "\n");
		const lines = normalized.split("\n");
		let frontmatterLineCount = 0;
		if (normalized.startsWith("---")) {
			const nextSeparator = lines.indexOf("---", 1);
			if (nextSeparator !== -1) {
				frontmatterLineCount = nextSeparator + 1;
			}
		}

		const bodyLineIndex = cursorLine - frontmatterLineCount;
		if (bodyLineIndex < 0) return 0;

		const bodyContent = lines.slice(frontmatterLineCount).join("\n");
		const bodyLines = bodyContent.split("\n");
		const linesBeforeCursor = bodyLines.slice(0, bodyLineIndex + 1);
		const textBeforeCursor = linesBeforeCursor.join("\n");

		const blocks = textBeforeCursor.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
		return Math.max(0, blocks.length - 1);
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
				
				new Notice(`Successfully enqueued import for ${file.name} (Job ID: ${job.jobId})`);
				
				await this.app.fileManager.trashFile(file);
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				new Notice(`Failed to upload ${file.name}: ${message}`);
			}
		}
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
}

export class ChapterTitleModal extends Modal {
	private title: string = "";
	private onSubmit: (title: string) => void;

	constructor(app: App, defaultTitle: string, onSubmit: (title: string) => void) {
		super(app);
		this.title = defaultTitle;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Enter new chapter title" });

		new Setting(contentEl)
			.setName("Title")
			.addText((text: any) =>
				text
					.setValue(this.title)
					.onChange((value: string) => {
						this.title = value;
					})
			);

		new Setting(contentEl)
			.addButton((btn: any) =>
				btn
					.setButtonText("Split")
					.setCta()
					.onClick(() => {
						if (this.title.trim()) {
							this.onSubmit(this.title.trim());
							this.close();
						} else {
							new Notice("Please enter a title");
						}
					})
			)
			.addButton((btn: any) =>
				btn
					.setButtonText("Cancel")
					.onClick(() => {
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
