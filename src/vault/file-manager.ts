/**
 * File manager for creating and updating vault files
 */

import { App, TFile, normalizePath } from "obsidian";
import {
	createMarkdownWithFrontmatter,
	createSeriesFrontmatter,
	createVolumeFrontmatter,
	createChapterFrontmatter,
	parseFrontmatter,
	stringifyFrontmatter,
} from "./frontmatter";
import { VaultStructure } from "./structure";
import type {
	SeriesResponse,
	VolumeResponse,
	ChapterResponse,
} from "../types";
import { segmentsToMarkdown, descriptionToMarkdown } from "../converter";

export class FileManager {
	constructor(
		private app: App,
		private structure: VaultStructure
	) {}

	/**
	 * Create or update the series metadata file
	 */
	async writeSeriesFile(series: SeriesResponse): Promise<string> {
		if (!series.id || !series.title) {
			throw new Error("Series must have id and title");
		}

		await this.structure.createSeriesFolder(series.title);
		const filePath = this.structure.getSeriesMetadataPath(series.title);

		const frontmatter = createSeriesFrontmatter(series.id, series.title, {
			authors: series.metadata?.authors || undefined,
			artists: series.metadata?.artists || undefined,
			tags: series.metadata?.tags || undefined,
			coverImage: series.metadata?.coverImage || undefined,
		});

		const description = series.metadata?.description
			? descriptionToMarkdown(series.metadata.description)
			: "";

		const content = createMarkdownWithFrontmatter(frontmatter, description);

		await this.writeFile(filePath, content);
		return filePath;
	}

	/**
	 * Create or update the volume metadata file
	 */
	async writeVolumeFile(volume: VolumeResponse, seriesTitle: string): Promise<string> {
		if (!volume.id || !volume.title || !volume.seriesId) {
			throw new Error("Volume must have id, title, and seriesId");
		}

		await this.structure.createVolumeFolder(seriesTitle, volume.title, volume.order);
		const filePath = this.structure.getVolumeMetadataPath(seriesTitle, volume.title, volume.order);

		const frontmatter = createVolumeFrontmatter(volume.id, volume.seriesId, volume.title, volume.order, {
			publicationDate: volume.metadata?.publicationDate || undefined,
			isbn: volume.metadata?.isbn || undefined,
			coverImage: volume.metadata?.coverImage || undefined,
		});

		const content = createMarkdownWithFrontmatter(frontmatter, "");

		await this.writeFile(filePath, content);
		return filePath;
	}

	/**
	 * Create or update a chapter file
	 */
	async writeChapterFile(
		chapter: ChapterResponse,
		seriesTitle: string,
		volumeTitle: string,
		volumeOrder: number
	): Promise<string> {
		if (!chapter.id || !chapter.title || !chapter.volumeId) {
			throw new Error("Chapter must have id, title, and volumeId");
		}

		const filePath = this.structure.getChapterFilePath(
			seriesTitle,
			volumeTitle,
			volumeOrder,
			chapter.title,
			chapter.order
		);

		const frontmatter = createChapterFrontmatter(
			chapter.id,
			chapter.volumeId,
			chapter.title,
			chapter.order
		);

		const chapterContent = segmentsToMarkdown(chapter.content, chapter.footnotes);
		const content = createMarkdownWithFrontmatter(frontmatter, chapterContent);

		await this.writeFile(filePath, content);
		return filePath;
	}

	/**
	 * Read a file's content
	 */
	async readFile(filePath: string): Promise<string | null> {
		const normalizedPath = normalizePath(filePath);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);

		if (!(file instanceof TFile)) {
			return null;
		}

		return await this.app.vault.read(file);
	}

	/**
	 * Write content to a file, creating it if it doesn't exist
	 */
	async writeFile(filePath: string, content: string): Promise<void> {
		const normalizedPath = normalizePath(filePath);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);

		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			// Ensure parent folder exists
			const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf("/"));
			if (parentPath) {
				await this.structure.ensureFolder(parentPath);
			}
			await this.app.vault.create(normalizedPath, content);
		}
	}

	/**
	 * Update only the frontmatter of a file, preserving content
	 */
	async updateFrontmatter(filePath: string, updates: Record<string, unknown>): Promise<void> {
		const content = await this.readFile(filePath);
		if (!content) {
			throw new Error(`File not found: ${filePath}`);
		}

		const { frontmatter, content: bodyContent } = parseFrontmatter(content);
		const newFrontmatter = { ...frontmatter, ...updates };
		const newContent = createMarkdownWithFrontmatter(newFrontmatter, bodyContent);

		await this.writeFile(filePath, newContent);
	}

	/**
	 * Delete a file
	 */
	async deleteFile(filePath: string): Promise<void> {
		const normalizedPath = normalizePath(filePath);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);

		if (file instanceof TFile) {
			await this.app.vault.delete(file);
		}
	}

	/**
	 * Check if a file exists
	 */
	fileExists(filePath: string): boolean {
		const normalizedPath = normalizePath(filePath);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		return file instanceof TFile;
	}
}
