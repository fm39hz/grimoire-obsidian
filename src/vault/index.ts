/**
 * Vault module index
 */

export { VaultStructure } from "./structure";
export type { VaultSeries, VaultVolume, VaultChapter } from "./structure";
export { FileManager } from "./file-manager";
export {
	parseFrontmatter,
	stringifyFrontmatter,
	createMarkdownWithFrontmatter,
	hasGrimoireFrontmatter,
	getEntityType,
	parseSeriesFrontmatter,
	parseVolumeFrontmatter,
	parseChapterFrontmatter,
	createSeriesFrontmatter,
	createVolumeFrontmatter,
	createChapterFrontmatter,
} from "./frontmatter";
