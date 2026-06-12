import { ItemView, WorkspaceLeaf, TFile, TFolder, TAbstractFile, Notice, setIcon, Menu } from "obsidian";
import type GrimoireSyncPlugin from "../main";
import { SERIES_METADATA_FILE, VOLUME_METADATA_FILE } from "../utils";

export const GRIMOIRE_TREE_VIEW = "grimoire-book-tree";

export class GrimoireTreeView extends ItemView {
	private plugin: GrimoireSyncPlugin;
	private expandedPaths: Set<string> = new Set();
	private selectedPaths: Set<string> = new Set();
	private lastClickedPath: string | null = null;
	private debounceTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: GrimoireSyncPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return GRIMOIRE_TREE_VIEW;
	}

	getDisplayText(): string {
		return "Grimoire Book Explorer";
	}

	getIcon(): string {
		return "folder-tree";
	}

	async onOpen() {
		this.registerEvent(this.app.vault.on("create", () => this.debouncedRefresh()));
		this.registerEvent(this.app.vault.on("delete", () => this.debouncedRefresh()));
		this.registerEvent(this.app.vault.on("rename", () => this.debouncedRefresh()));
		this.registerEvent(this.app.vault.on("modify", (file) => {
			if (file instanceof TFile && file.extension === "md") {
				this.debouncedRefresh();
			}
		}));
		this.registerEvent(this.app.metadataCache.on("changed", () => this.debouncedRefresh()));
		
		// Highlight active file on editor open
		this.registerEvent(this.app.workspace.on("file-open", () => this.updateActiveFileHighlight()));

		this.refreshView();
	}

	async onClose() {
		this.expandedPaths.clear();
		this.selectedPaths.clear();
		this.lastClickedPath = null;
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	private debouncedRefresh() {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = window.setTimeout(() => {
			this.refreshView();
			this.debounceTimer = null;
		}, 100);
	}

	/**
	 * Refresh the full tree view structure
	 */
	refreshView() {
		this.contentEl.empty();
		this.contentEl.className = "view-content nav-files-container node-insert-event file-explorer";
		
		const rootFolder = this.app.vault.getRoot();
		this.renderFolderChildren(this.contentEl, rootFolder);
		this.updateActiveFileHighlight();
		this.updateSelectionHighlights();
	}

	/**
	 * Classify a file/folder to determine how to sort and display it
	 */
	private getFileMetadata(file: TAbstractFile) {
		if (file instanceof TFile) {
			if (file.extension !== "md") {
				return { type: "file" as const, order: 9999, title: file.name };
			}
			if (file.name === SERIES_METADATA_FILE) {
				return { type: "series-meta" as const, order: -1, title: file.name };
			}
			if (file.name === VOLUME_METADATA_FILE) {
				return { type: "volume-meta" as const, order: -1, title: file.name };
			}
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter?.["grimoire_type"] === "chapter") {
				const order = Number(cache.frontmatter["order"]) ?? 0;
				const title = cache.frontmatter["title"] || file.basename;
				return { type: "chapter" as const, order, title };
			}
			return { type: "markdown" as const, order: 9999, title: file.basename };
		} else if (file instanceof TFolder) {
			// Check if it's a Series folder (contains _series.md)
			const seriesMetaPath = `${file.path}/${SERIES_METADATA_FILE}`;
			const seriesMeta = this.app.vault.getAbstractFileByPath(seriesMetaPath);
			if (seriesMeta instanceof TFile) {
				const cache = this.app.metadataCache.getFileCache(seriesMeta);
				const title = cache?.frontmatter?.["title"] || file.name;
				return { type: "series" as const, order: 0, title };
			}

			// Check if it's a Volume folder (contains _volume.md)
			const volumeMetaPath = `${file.path}/${VOLUME_METADATA_FILE}`;
			const volumeMeta = this.app.vault.getAbstractFileByPath(volumeMetaPath);
			if (volumeMeta instanceof TFile) {
				const cache = this.app.metadataCache.getFileCache(volumeMeta);
				const order = Number(cache?.frontmatter?.["order"]) ?? 0;
				const title = cache?.frontmatter?.["title"] || file.name;
				return { type: "volume" as const, order, title };
			}

			return { type: "folder" as const, order: 9999, title: file.name };
		}
		return null;
	}

	/**
	 * Sort folder children: folders first, then files.
	 * Grimoire volumes and chapters are sorted by their database order.
	 */
	private sortFolderChildren(children: TAbstractFile[]): TAbstractFile[] {
		const folders: { file: TAbstractFile; type: string; order: number; title: string }[] = [];
		const files: { file: TAbstractFile; type: string; order: number; title: string }[] = [];

		for (const child of children) {
			const meta = this.getFileMetadata(child);
			if (!meta) continue;

			// Hide metadata files
			if (meta.type === "series-meta" || meta.type === "volume-meta") {
				continue;
			}

			if (child instanceof TFolder) {
				folders.push({ file: child, ...meta });
			} else {
				files.push({ file: child, ...meta });
			}
		}

		const compare = (a: any, b: any) => {
			if (a.order !== b.order) {
				return a.order - b.order;
			}
			return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
		};

		folders.sort(compare);
		files.sort(compare);

		return [...folders.map(f => f.file), ...files.map(f => f.file)];
	}

	/**
	 * Render folder children into the parent element
	 */
	private renderFolderChildren(parentEl: HTMLElement, folder: TFolder) {
		parentEl.empty();
		const sorted = this.sortFolderChildren(folder.children);
		for (const child of sorted) {
			if (child instanceof TFolder) {
				this.renderFolder(parentEl, child);
			} else if (child instanceof TFile) {
				this.renderFile(parentEl, child);
			}
		}
	}

	/**
	 * Render a folder node (expanded or collapsed)
	 */
	private renderFolder(parentEl: HTMLElement, folder: TFolder) {
		const meta = this.getFileMetadata(folder);
		if (!meta) return;

		const isExpanded = this.expandedPaths.has(folder.path);
		const folderEl = parentEl.createDiv({ cls: `tree-item nav-folder ${isExpanded ? "" : "is-collapsed"}` });
		const titleEl = folderEl.createDiv({ cls: "tree-item-self nav-folder-title" });
		titleEl.setAttribute("data-path", folder.path);
		
		// Collapse indicator
		const iconEl = titleEl.createDiv({ cls: `tree-item-icon nav-folder-collapse-indicator collapse-icon${isExpanded ? "" : " is-collapsed"}` });
		setIcon(iconEl, "right-triangle");

		const innerEl = titleEl.createDiv({ cls: "tree-item-inner nav-folder-title-content", text: meta.title });

		// Show a visual badge for desynced series
		if (meta.type === "series" && !this.plugin.isSeriesSynced(folder)) {
			innerEl.createSpan({ cls: "grimoire-desynced-badge", text: " [desynced]" });
		}

		const childrenEl = folderEl.createDiv({ cls: "tree-item-children nav-folder-children" });

		if (isExpanded) {
			this.renderFolderChildren(childrenEl, folder);
		}

		// Chevron collapse click
		iconEl.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleFolderCollapse(folder, folderEl, iconEl, childrenEl);
		});

		// Folder title selection click
		titleEl.addEventListener("click", (e) => {
			e.stopPropagation();
			this.handleItemSelectionClick(e, folder.path);
			
			if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
				this.toggleFolderCollapse(folder, folderEl, iconEl, childrenEl);
			}
		});

		// Trigger standard Obsidian context menu on right click
		titleEl.addEventListener("contextmenu", (e) => {
			this.handleItemContextMenu(e, folder);
		});
	}

	private toggleFolderCollapse(folder: TFolder, folderEl: HTMLElement, iconEl: HTMLElement, childrenEl: HTMLElement) {
		const currentlyExpanded = this.expandedPaths.has(folder.path);
		if (currentlyExpanded) {
			this.expandedPaths.delete(folder.path);
			folderEl.addClass("is-collapsed");
			iconEl.addClass("is-collapsed");
			childrenEl.empty();
		} else {
			this.expandedPaths.add(folder.path);
			folderEl.removeClass("is-collapsed");
			iconEl.removeClass("is-collapsed");
			this.renderFolderChildren(childrenEl, folder);
		}
	}

	/**
	 * Render a file node
	 */
	private renderFile(parentEl: HTMLElement, file: TFile) {
		const meta = this.getFileMetadata(file);
		if (!meta) return;

		const fileEl = parentEl.createDiv({ cls: "tree-item nav-file" });
		const titleEl = fileEl.createDiv({ cls: "tree-item-self nav-file-title" });
		titleEl.setAttribute("data-path", file.path);

		// Status dot
		if (meta.type === "chapter") {
			const statusDot = titleEl.createDiv({ cls: "grimoire-status-dot" });
			this.updateChapterStatusIndicator(file, statusDot);
		}

		titleEl.createDiv({ cls: "tree-item-inner nav-file-title-content", text: meta.title });

		// Open file on click and set active selection
		titleEl.addEventListener("click", async (e) => {
			e.stopPropagation();
			
			this.handleItemSelectionClick(e, file.path);

			const leaf = this.app.workspace.getLeaf(false);
			if (leaf) {
				await leaf.openFile(file);
			}
		});

		// Trigger standard Obsidian context menu on right click
		titleEl.addEventListener("contextmenu", (e) => {
			this.handleItemContextMenu(e, file);
		});
	}

	/**
	 * Selection click handler with modifier support (Ctrl, Shift, etc.)
	 */
	private handleItemSelectionClick(e: MouseEvent, path: string) {
		const isCmdOrCtrl = e.ctrlKey || e.metaKey;
		const isShift = e.shiftKey;

		if (isShift && this.lastClickedPath) {
			// Shift + Click: Select range of visible rows
			const rows = Array.from(this.contentEl.querySelectorAll(".tree-item-self")) as HTMLElement[];
			const idx1 = rows.findIndex(row => row.getAttribute("data-path") === this.lastClickedPath);
			const idx2 = rows.findIndex(row => row.getAttribute("data-path") === path);

			if (idx1 !== -1 && idx2 !== -1) {
				const start = Math.min(idx1, idx2);
				const end = Math.max(idx1, idx2);

				if (!isCmdOrCtrl) {
					this.selectedPaths.clear();
				}

				for (let i = start; i <= end; i++) {
					const row = rows[i];
					const rowPath = row?.getAttribute("data-path");
					if (rowPath) {
						this.selectedPaths.add(rowPath);
					}
				}
			}
		} else if (isCmdOrCtrl) {
			// Ctrl/Cmd + Click: Toggle individual selection
			if (this.selectedPaths.has(path)) {
				this.selectedPaths.delete(path);
			} else {
				this.selectedPaths.add(path);
			}
			this.lastClickedPath = path;
		} else {
			// Standard Click: Clear selections and select exclusively
			this.selectedPaths.clear();
			this.selectedPaths.add(path);
			this.lastClickedPath = path;
		}

		this.updateSelectionHighlights();
	}

	/**
	 * Handle context menu for single/multiple selection
	 */
	private handleItemContextMenu(e: MouseEvent, file: TAbstractFile) {
		e.preventDefault();
		e.stopPropagation();

		// If right-clicked item is not in selection list, select it exclusively
		if (!this.selectedPaths.has(file.path)) {
			this.selectedPaths.clear();
			this.selectedPaths.add(file.path);
			this.lastClickedPath = file.path;
			this.updateSelectionHighlights();
		}

		const menu = new Menu();

		const selectedFiles: TAbstractFile[] = [];
		this.selectedPaths.forEach(path => {
			const f = this.app.vault.getAbstractFileByPath(path);
			if (f) {
				selectedFiles.push(f);
			}
		});

		if (selectedFiles.length > 1) {
			// Trigger files-menu context menu event (for multi-selection)
			this.app.workspace.trigger("files-menu", menu, selectedFiles, "file-explorer");
		} else {
			// Trigger file-menu context menu event (for single selection)
			this.app.workspace.trigger("file-menu", menu, file, "file-explorer");
		}

		// Add rename option (single file only)
		if (selectedFiles.length <= 1) {
			menu.addSeparator();
			menu.addItem((item) => {
				item
					.setTitle("Rename")
					.setIcon("pencil")
					.onClick(() => {
						const newName = window.prompt("Rename to:", file.name);
						if (newName && newName.trim() && newName !== file.name) {
							const newPath = file.parent
								? `${file.parent.path}/${newName.trim()}`
								: newName.trim();
							this.app.fileManager.renameFile(file, newPath);
						}
					});
			});
		}

		// Add sync/desync option for series folders (single selection only)
		if (selectedFiles.length <= 1 && file instanceof TFolder) {
			const meta = this.getFileMetadata(file);
			if (meta?.type === "series") {
				const isSynced = this.plugin.isSeriesSynced(file);
				menu.addSeparator();
				menu.addItem((item) => {
					item
						.setTitle(isSynced ? "Desync from Grimoire" : "Sync with Grimoire")
						.setIcon(isSynced ? "unlink" : "link")
						.onClick(async () => {
							await this.plugin.toggleSeriesSync(file);
						});
				});
			}
		}

		// Add delete option for all selections
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(selectedFiles.length > 1 ? `Delete ${selectedFiles.length} files` : "Delete")
				.setIcon("trash")
				.onClick(async () => {
					const targets = selectedFiles.length > 0 ? selectedFiles : [file];
					for (const f of targets) {
						await this.app.fileManager.trashFile(f);
					}
				});
		});

		menu.showAtPosition({ x: e.clientX, y: e.clientY });
	}

	private updateChapterStatusIndicator(file: TFile, dotEl: HTMLElement) {
		dotEl.className = "grimoire-status-dot";
		const isModified = this.plugin.syncManager?.isLocallyModified(file);
		if (isModified) {
			dotEl.addClass("status-modified");
			dotEl.setAttribute("title", "Modified locally");
		} else {
			dotEl.addClass("status-synced");
			dotEl.setAttribute("title", "Synchronized");
		}
	}

	/**
	 * Update the highlighted active file in the tree to match editor focus
	 */
	private updateActiveFileHighlight() {
		this.contentEl.querySelectorAll(".tree-item-self.is-active").forEach((el) => {
			el.removeClass("is-active");
		});

		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			try {
				const activeEl = this.contentEl.querySelector(`.tree-item-self[data-path="${CSS.escape(activeFile.path)}"]`);
				if (activeEl) {
					activeEl.addClass("is-active");
				}
			} catch (err) {
				// Prevent issues with weird file paths
			}
		}
	}

	/**
	 * Apply standard .is-selected classes to all selected elements in the DOM
	 */
	private updateSelectionHighlights() {
		this.contentEl.querySelectorAll(".tree-item-self.is-selected").forEach((el) => {
			el.removeClass("is-selected");
		});

		this.selectedPaths.forEach((path) => {
			try {
				const el = this.contentEl.querySelector(`.tree-item-self[data-path="${CSS.escape(path)}"]`);
				if (el) {
					el.addClass("is-selected");
				}
			} catch (err) {
				// Prevent path selector issues
			}
		});
	}

	/**
	 * Reveal a file/folder in the tree view by expanding its parent folders and scrolling it into view.
	 * Implements the standard Obsidian File Explorer API for compatibility.
	 */
	public revealFile(file: TAbstractFile) {
		let parent = file.parent;
		const pathsToExpand: string[] = [];
		while (parent && !parent.isRoot()) {
			pathsToExpand.push(parent.path);
			parent = parent.parent;
		}
		pathsToExpand.reverse();
		for (const path of pathsToExpand) {
			this.expandedPaths.add(path);
		}

		this.refreshView();

		this.selectedPaths.clear();
		this.selectedPaths.add(file.path);
		this.updateSelectionHighlights();

		try {
			const el = this.contentEl.querySelector(`.tree-item-self[data-path="${CSS.escape(file.path)}"]`);
			if (el) {
				el.scrollIntoView({ block: "center", behavior: "smooth" });
			}
		} catch (err) {
			// Prevent selector/scroll issues
		}
	}

	public select(file: TAbstractFile) {
		this.revealFile(file);
	}

	public revealInFolder(file: TAbstractFile) {
		this.revealFile(file);
	}

	public reveal(file: TAbstractFile) {
		this.revealFile(file);
	}
}
