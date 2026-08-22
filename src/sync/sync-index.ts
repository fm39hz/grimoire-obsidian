import { App, TFile, normalizePath } from "obsidian";

export interface SyncIndexEntry {
	localHash: string;
	remoteHash: string;
	lastSyncedAt: number;
	lastError?: string;
}

export class SyncIndex {
	private indexPath = ".grimoire/sync-index.json";
	private entries: Map<string, SyncIndexEntry> = new Map();

	constructor(private app: App) {}

	/**
	 * Compute SHA-256 hash of a string
	 */
	async computeHash(content: string): Promise<string> {
		const msgBuffer = new TextEncoder().encode(content);
		const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
	}

	/**
	 * Load the index from file
	 */
	async load(): Promise<void> {
		try {
			const normalized = normalizePath(this.indexPath);
			const exists = await this.app.vault.adapter.exists(normalized);
			if (!exists) {
				this.entries = new Map();
				return;
			}

			const content = await this.app.vault.adapter.read(normalized);
			const parsed = JSON.parse(content);
			this.entries = new Map(Object.entries(parsed));
		} catch (error) {
			console.error("Failed to load Grimoire sync index:", error);
			this.entries = new Map();
		}
	}

	/**
	 * Save the index to file
	 */
	async save(): Promise<void> {
		try {
			const normalized = normalizePath(this.indexPath);
			const obj = Object.fromEntries(this.entries);
			const json = JSON.stringify(obj, null, 2);

			// Ensure parent folder exists
			const parentPath = normalized.substring(0, normalized.lastIndexOf("/"));
			if (parentPath && !(await this.app.vault.adapter.exists(parentPath))) {
				await this.app.vault.adapter.mkdir(parentPath);
			}

			await this.app.vault.adapter.write(normalized, json);
		} catch (error) {
			console.error("Failed to save Grimoire sync index:", error);
		}
	}

	getEntry(filePath: string): SyncIndexEntry | undefined {
		return this.entries.get(normalizePath(filePath));
	}

	setEntry(filePath: string, localHash: string, remoteHash: string): void {
		this.entries.set(normalizePath(filePath), {
			localHash,
			remoteHash,
			lastSyncedAt: Date.now(),
			lastError: undefined
		});
	}

	setError(filePath: string, message: string): void {
		const normalized = normalizePath(filePath);
		const entry = this.entries.get(normalized);
		if (entry) {
			entry.lastError = message;
		} else {
			this.entries.set(normalized, {
				localHash: "",
				remoteHash: "",
				lastSyncedAt: 0,
				lastError: message
			});
		}
	}

	removeEntry(filePath: string): void {
		this.entries.delete(normalizePath(filePath));
	}
}
