import { App, TFile, Notice, normalizePath } from "obsidian";
import type { GrimoireApi } from "../api";
import type { SyncManager } from "../sync";
import { ChapterTitleModal } from "../ui";
import { joinPath } from "../utils";

export class ChapterOpsHandler {
	constructor(
		private app: App,
		private syncManager: SyncManager,
		private api: GrimoireApi,
		private refreshBookTreeView: () => void
	) {}

	/**
	 * Merges multiple chapter files into one on the server and updates local files
	 */
	public async mergeChapters(chapterFiles: TFile[]): Promise<void> {
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
						const volumeTitle = volumeFolder.name;
						const volumeOrder = Number(volCache?.frontmatter?.["order"]) || 0;

						// Save local changes to server only if they are modified
						for (const sf of sortedFiles) {
							if (this.syncManager.isLocallyModified(sf.file)) {
								new Notice(`Saving local changes for ${sf.file.name}...`);
								const displayOrder = sf.order;
								await this.syncManager.bidirectionalSync.pushChapter(
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

						// Trash the old files first (mark as programmatic to skip server delete)
						for (const sf of sortedFiles) {
							this.syncManager.markPathAsProgrammatic(sf.file.path);
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

	/**
	 * Splits a chapter file at the cursor position
	 */
	public async splitChapter(file: TFile, cursorLine: number): Promise<void> {
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
							const volumeTitle = volumeFolder.name;
							const volumeOrder = Number(volCache?.frontmatter?.["order"]) || 0;
							const displayOrder = Number(cache?.frontmatter?.["order"]) || 0;

							// Save local changes to server only if modified
							if (this.syncManager.isLocallyModified(file)) {
								new Notice("Saving local changes to server...");
								await this.syncManager.bidirectionalSync.pushChapter(
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

							const resultChapters = await this.api.chapters.split(chapterId, {
								splitPoints: [{ segmentIndex, newChapterTitle: newTitle }]
							});

							new Notice("Chapter split successfully on server!");

							// Trash the old original file first to prevent duplicate filename issues
							// Mark as programmatic so handleFileDelete doesn't cascade a server delete
							this.syncManager.markPathAsProgrammatic(file.path);
							const oldFile = this.app.vault.getAbstractFileByPath(file.path);
							if (oldFile instanceof TFile) {
								await this.app.fileManager.trashFile(oldFile);
							}

							// Write the newly split chapters (original + new ones) using returned markdown content directly
							for (const rc of resultChapters) {
								if (!rc.id) continue;
								await this.syncManager.fileManager.writeChapterFile(rc, seriesTitle, volumeTitle, volumeOrder, rc.order);
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

	/**
	 * Computes the text block content at the cursor line
	 */
	public getSegmentTextAtCursor(markdown: string, cursorLine: number): string {
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

	/**
	 * Computes the paragraph/segment index at the cursor line
	 */
	public getSegmentIndexAtCursor(markdown: string, cursorLine: number): number {
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
}
