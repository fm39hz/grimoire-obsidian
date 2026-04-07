/**
 * Utility helper functions
 */

/**
 * Sanitize a string for use as a file/folder name
 * Removes or replaces characters that are invalid in file systems
 */
export function sanitizeFileName(name: string): string {
	return name
		.replace(/[<>:"/\\|?*]/g, "") // Remove invalid characters
		.replace(/\s+/g, " ") // Normalize whitespace
		.trim();
}

/**
 * Create a folder-safe name with order prefix
 * e.g., "Chapter Title" with order 1 -> "001 - Chapter Title"
 */
export function createOrderedName(title: string, order: number, padLength = 3): string {
	const paddedOrder = String(order).padStart(padLength, "0");
	const safeName = sanitizeFileName(title);
	return `${paddedOrder} - ${safeName}`;
}

/**
 * Extract order number from an ordered name
 * e.g., "001 - Chapter Title" -> 1
 */
export function extractOrderFromName(name: string): number | null {
	const match = name.match(/^(\d+)\s*-\s*/);
	if (match && match[1]) {
		return parseInt(match[1], 10);
	}
	return null;
}

/**
 * Get current timestamp in ISO 8601 format
 */
export function getCurrentTimestamp(): string {
	return new Date().toISOString();
}

/**
 * Parse an ISO 8601 timestamp to Date
 */
export function parseTimestamp(timestamp: string): Date {
	return new Date(timestamp);
}

/**
 * Compare two timestamps, returns:
 * - negative if a < b
 * - 0 if a === b
 * - positive if a > b
 */
export function compareTimestamps(a: string | undefined, b: string | undefined): number {
	if (!a && !b) return 0;
	if (!a) return -1;
	if (!b) return 1;
	return new Date(a).getTime() - new Date(b).getTime();
}

/**
 * Normalize a path to use forward slashes
 */
export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

/**
 * Join path segments safely
 */
export function joinPath(...segments: string[]): string {
	return normalizePath(segments.filter(Boolean).join("/"));
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => void>(
	func: T,
	wait: number
): (...args: Parameters<T>) => void {
	let timeout: ReturnType<typeof setTimeout> | null = null;

	return (...args: Parameters<T>) => {
		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => {
			func(...args);
		}, wait);
	};
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
