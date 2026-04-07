/**
 * Vault structure management
 * Handles creation and navigation of Series > Volume > Chapter folder structure
 */

import { App, TFolder, TFile, Vault, normalizePath } from "obsidian";
import { SERIES_METADATA_FILE, VOLUME_METADATA_FILE, MARKDOWN_EXTENSION } from "../utils";
import { sanitizeFileName, createOrderedName, joinPath } from "../utils";
import { parseSeriesFrontmatter, parseVolumeFrontmatter, parseChapterFrontmatter } from "./frontmatter";
import type { SeriesFrontmatter, VolumeFrontmatter, ChapterFrontmatter } from "../types";

/**
 * Information about a series in the vault
 */
export interface VaultSeries {
	folderPath: string;
	metadataPath: string;
	frontmatter: SeriesFrontmatter;
}

/**
 * Information about a volume in the vault
 */
export interface VaultVolume {
	folderPath: string;
	metadataPath: string;
	frontmatter: VolumeFrontmatter;
}

/**
 * Information about a chapter in the vault
 */
export interface VaultChapter {
	filePath: string;
	frontmatter: ChapterFrontmatter;
}

export class VaultStructure {
	constructor(
		private app: App,
		private syncFolder: string
	) {}

	/**
	 * Update the sync folder path
	 */
	setSyncFolder(syncFolder: string): void {
		this.syncFolder = syncFolder;
	}

	/**
	 * Get the root sync folder path
	 */
	getSyncFolderPath(): string {
		return normalizePath(this.syncFolder);
	}

	/**
	 * Ensure the sync folder exists
	 */
	async ensureSyncFolder(): Promise<void> {
		const path = this.getSyncFolderPath();
		await this.ensureFolder(path);
	}

	/**
	 * Ensure a folder exists, creating it if necessary
	 */
	async ensureFolder(path: string): Promise<TFolder> {
		const normalizedPath = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalizedPath);

		if (existing instanceof TFolder) {
			return existing;
		}

		// Create folder and any parent folders
		await this.app.vault.createFolder(normalizedPath);
		const created = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (!(created instanceof TFolder)) {
			throw new Error(`Failed to create folder: ${normalizedPath}`);
		}
		return created;
	}

	/**
	 * Get the path for a series folder
	 */
	getSeriesFolderPath(seriesTitle: string): string {
		const safeName = sanitizeFileName(seriesTitle);
		return normalizePath(joinPath(this.syncFolder, safeName));
	}

	/**
	 * Get the path for the series metadata file
	 */
	getSeriesMetadataPath(seriesTitle: string): string {
		const folderPath = this.getSeriesFolderPath(seriesTitle);
		return normalizePath(joinPath(folderPath, SERIES_METADATA_FILE));
	}

	/**
	 * Get the path for a volume folder
	 */
	getVolumeFolderPath(seriesTitle: string, volumeTitle: string, volumeOrder: number): string {
		const seriesPath = this.getSeriesFolderPath(seriesTitle);
		const volumeFolderName = createOrderedName(volumeTitle, volumeOrder);
		return normalizePath(joinPath(seriesPath, volumeFolderName));
	}

	/**
	 * Get the path for the volume metadata file
	 */
	getVolumeMetadataPath(seriesTitle: string, volumeTitle: string, volumeOrder: number): string {
		const folderPath = this.getVolumeFolderPath(seriesTitle, volumeTitle, volumeOrder);
		return normalizePath(joinPath(folderPath, VOLUME_METADATA_FILE));
	}

	/**
	 * Get the path for a chapter file
	 */
	getChapterFilePath(
		seriesTitle: string,
		volumeTitle: string,
		volumeOrder: number,
		chapterTitle: string,
		chapterOrder: number
	): string {
		const volumePath = this.getVolumeFolderPath(seriesTitle, volumeTitle, volumeOrder);
		const chapterFileName = createOrderedName(chapterTitle, chapterOrder) + MARKDOWN_EXTENSION;
		return normalizePath(joinPath(volumePath, chapterFileName));
	}

	/**
	 * Create the folder structure for a series
	 */
	async createSeriesFolder(seriesTitle: string): Promise<string> {
		const folderPath = this.getSeriesFolderPath(seriesTitle);
		await this.ensureFolder(folderPath);
		return folderPath;
	}

	/**
	 * Create the folder structure for a volume
	 */
	async createVolumeFolder(seriesTitle: string, volumeTitle: string, volumeOrder: number): Promise<string> {
		const folderPath = this.getVolumeFolderPath(seriesTitle, volumeTitle, volumeOrder);
		await this.ensureFolder(folderPath);
		return folderPath;
	}

	/**
	 * Find all series in the sync folder
	 */
	async findAllSeries(): Promise<VaultSeries[]> {
		const syncPath = this.getSyncFolderPath();
		const syncFolder = this.app.vault.getAbstractFileByPath(syncPath);

		if (!(syncFolder instanceof TFolder)) {
			return [];
		}

		const series: VaultSeries[] = [];

		for (const child of syncFolder.children) {
			if (child instanceof TFolder) {
				const metadataPath = normalizePath(joinPath(child.path, SERIES_METADATA_FILE));
				const metadataFile = this.app.vault.getAbstractFileByPath(metadataPath);

				if (metadataFile instanceof TFile) {
					const content = await this.app.vault.read(metadataFile);
					const frontmatter = parseSeriesFrontmatter(content);

					if (frontmatter) {
						series.push({
							folderPath: child.path,
							metadataPath,
							frontmatter,
						});
					}
				}
			}
		}

		return series;
	}

	/**
	 * Find all volumes in a series folder
	 */
	async findVolumesInSeries(seriesFolderPath: string): Promise<VaultVolume[]> {
		const seriesFolder = this.app.vault.getAbstractFileByPath(seriesFolderPath);

		if (!(seriesFolder instanceof TFolder)) {
			return [];
		}

		const volumes: VaultVolume[] = [];

		for (const child of seriesFolder.children) {
			if (child instanceof TFolder) {
				const metadataPath = normalizePath(joinPath(child.path, VOLUME_METADATA_FILE));
				const metadataFile = this.app.vault.getAbstractFileByPath(metadataPath);

				if (metadataFile instanceof TFile) {
					const content = await this.app.vault.read(metadataFile);
					const frontmatter = parseVolumeFrontmatter(content);

					if (frontmatter) {
						volumes.push({
							folderPath: child.path,
							metadataPath,
							frontmatter,
						});
					}
				}
			}
		}

		// Sort by order
		volumes.sort((a, b) => a.frontmatter.order - b.frontmatter.order);

		return volumes;
	}

	/**
	 * Find all chapters in a volume folder
	 */
	async findChaptersInVolume(volumeFolderPath: string): Promise<VaultChapter[]> {
		const volumeFolder = this.app.vault.getAbstractFileByPath(volumeFolderPath);

		if (!(volumeFolder instanceof TFolder)) {
			return [];
		}

		const chapters: VaultChapter[] = [];

		for (const child of volumeFolder.children) {
			if (child instanceof TFile && child.extension === "md" && child.name !== VOLUME_METADATA_FILE) {
				const content = await this.app.vault.read(child);
				const frontmatter = parseChapterFrontmatter(content);

				if (frontmatter) {
					chapters.push({
						filePath: child.path,
						frontmatter,
					});
				}
			}
		}

		// Sort by order
		chapters.sort((a, b) => a.frontmatter.order - b.frontmatter.order);

		return chapters;
	}

	/**
	 * Find a series by its Grimoire ID
	 */
	async findSeriesById(grimoireId: string): Promise<VaultSeries | null> {
		const allSeries = await this.findAllSeries();
		return allSeries.find((s) => s.frontmatter.grimoire_id === grimoireId) || null;
	}

	/**
	 * Find a volume by its Grimoire ID
	 */
	async findVolumeById(grimoireId: string, seriesFolderPath: string): Promise<VaultVolume | null> {
		const volumes = await this.findVolumesInSeries(seriesFolderPath);
		return volumes.find((v) => v.frontmatter.grimoire_id === grimoireId) || null;
	}

	/**
	 * Find a chapter by its Grimoire ID
	 */
	async findChapterById(grimoireId: string, volumeFolderPath: string): Promise<VaultChapter | null> {
		const chapters = await this.findChaptersInVolume(volumeFolderPath);
		return chapters.find((c) => c.frontmatter.grimoire_id === grimoireId) || null;
	}
}
