import { ItemView, WorkspaceLeaf, TFile, TFolder, TAbstractFile, Notice, setIcon, Menu } from "obsidian";
import type GrimoireSyncPlugin from "../main";
import { SERIES_METADATA_FILE, VOLUME_METADATA_FILE } from "../utils";

export const GRIMOIRE_TREE_VIEW = "grimoire-book-tree";

export class GrimoireTreeView extends ItemView {
	private plugin: GrimoireSyncPlugin;
	private expandedPaths: Set<string> = new Set();
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
		const iconEl = titleEl.createDiv({ cls: "tree-item-icon nav-folder-collapse-indicator collapse-icon" });
		setIcon(iconEl, "right-triangle");

		titleEl.createDiv({ cls: "tree-item-inner nav-folder-title-content", text: meta.title });

		const childrenEl = folderEl.createDiv({ cls: "tree-item-children nav-folder-children" });

		if (isExpanded) {
			this.renderFolderChildren(childrenEl, folder);
		}

		// Toggle expand/collapse
		titleEl.addEventListener("click", (e) => {
			e.stopPropagation();
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
		});

		// Trigger standard Obsidian context menu on right click
		titleEl.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			const menu = new Menu();
			this.app.workspace.trigger("file-menu", menu, folder, "file-explorer");
			menu.showAtPosition({ x: e.clientX, y: e.clientY });
		});
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
			
			this.contentEl.querySelectorAll(".tree-item-self.is-active").forEach((el) => {
				el.removeClass("is-active");
			});
			titleEl.addClass("is-active");

			const leaf = this.app.workspace.getLeaf(false);
			if (leaf) {
				await leaf.openFile(file);
			}
		});

		// Trigger standard Obsidian context menu on right click
		titleEl.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			const menu = new Menu();
			this.app.workspace.trigger("file-menu", menu, file, "file-explorer");
			menu.showAtPosition({ x: e.clientX, y: e.clientY });
		});
	}

	/**
	 * Update chapter status dot based on local modifications
	 */
	private updateChapterStatusIndicator(file: TFile, dotEl: HTMLElement) {
		dotEl.className = "grimoire-status-dot";
		const isModified = this.plugin.syncManager?.pullSync.isLocallyModified(file);
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
}
