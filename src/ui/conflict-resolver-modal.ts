import { App, Modal, Notice, TFile } from "obsidian";
import type GrimoireSyncPlugin from "../main";
import { parseFrontmatter } from "../vault/frontmatter";

interface ConflictPair {
	conflictFile: TFile;
	localFile: TFile;
	localSnippet: string;
	serverSnippet: string;
}

/**
 * Lists every unresolved sync conflict (*.conflict.md) under a folder and lets the
 * user pick a side per conflict:
 *  - Keep mine   → drop the server copy; the local file becomes dirty and is pushed
 *                  on next sync.
 *  - Take server → overwrite the local body with the server copy and mark the file
 *                  freshly synced so the taken copy is not pushed straight back.
 */
export class ConflictResolverModal extends Modal {
	constructor(
		private plugin: GrimoireSyncPlugin,
		private rootPath?: string,
		private onChanged?: () => void
	) {
		super(plugin.app);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Resolve sync conflicts" });

		const pairs = await this.collectConflicts();

		if (pairs.length === 0) {
			contentEl.createEl("p", { text: "No conflicts found." });
			this.addCloseButton(contentEl);
			return;
		}

		contentEl.createEl("p", {
			text: `${pairs.length} conflict(s). The server version of each chapter was saved to a .conflict.md file during pull.`,
			cls: "grimoire-conflict-intro"
		});

		for (const pair of pairs) {
			contentEl.appendChild(this.buildRow(pair));
		}
	}

	private addCloseButton(contentEl: HTMLElement) {
		const buttons = contentEl.createDiv({ cls: "grimoire-conflict-buttons" });
		buttons.createEl("button", {
			text: "Close",
			cls: "mod-cta",
		}).addEventListener("click", () => this.close());
	}

	private async collectConflicts(): Promise<ConflictPair[]> {
		const prefix = this.rootPath ? `${this.rootPath}/` : "";
		const pairs: ConflictPair[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!file.name.endsWith(".conflict.md")) continue;
			if (prefix && !file.path.startsWith(prefix)) continue;

			const localPath = file.path.replace(/\.conflict\.md$/, ".md");
			const localFile = this.app.vault.getAbstractFileByPath(localPath);
			if (!(localFile instanceof TFile)) continue;

			pairs.push({
				conflictFile: file,
				localFile,
				localSnippet: this.bodyPreview(await this.app.vault.read(localFile)),
				serverSnippet: this.bodyPreview(await this.app.vault.read(file)),
			});
		}
		return pairs;
	}

	private bodyPreview(markdown: string, lines = 4): string {
		const { content } = parseFrontmatter(markdown);
		return content
			.split("\n")
			.map(l => l.trim())
			.filter(l => l.length > 0)
			.slice(0, lines)
			.join("\n");
	}

	private buildRow(pair: ConflictPair): HTMLElement {
		const row = createDiv({ cls: "grimoire-conflict-row" });
		row.createEl("strong", { text: pair.localFile.basename });

		const columns = row.createDiv({ cls: "grimoire-conflict-columns" });
		columns.createDiv({ cls: "grimoire-conflict-side" }, (el) => {
			el.createEl("div", {
				cls: "grimoire-conflict-side-title",
				text: `Mine (${new Date(pair.localFile.stat.mtime).toLocaleString()})`
			});
			el.createEl("pre", { text: pair.localSnippet });
		});
		columns.createDiv({ cls: "grimoire-conflict-side" }, (el) => {
			el.createEl("div", {
				cls: "grimoire-conflict-side-title",
				text: `Server (${new Date(pair.conflictFile.stat.mtime).toLocaleString()})`
			});
			el.createEl("pre", { text: pair.serverSnippet });
		});

		const actions = row.createDiv({ cls: "grimoire-conflict-actions" });
		actions.createEl("button", { text: "Keep mine" }).addEventListener("click", () =>
			void this.resolveKeepMine(pair));
		actions.createEl("button", { text: "Take server" }).addEventListener("click", () =>
			void this.resolveTakeServer(pair));

		return row;
	}

	private async resolveKeepMine(pair: ConflictPair): Promise<void> {
		const index = this.plugin.syncManager?.syncIndex;
		if (!index) return;

		await this.app.fileManager.trashFile(pair.conflictFile);
		// Force the local file to be considered dirty and pushed on next sync.
		index.removeEntry(pair.localFile.path);
		await index.save();
		new Notice(`Kept local version of "${pair.localFile.basename}". It will be pushed on next sync.`);
		this.refresh();
	}

	private async resolveTakeServer(pair: ConflictPair): Promise<void> {
		const index = this.plugin.syncManager?.syncIndex;
		if (!index) return;

		const conflictContent = await this.app.vault.read(pair.conflictFile);
		const { content: serverBody } = parseFrontmatter(conflictContent);

		await this.app.fileManager.trashFile(pair.conflictFile);
		// Mark as freshly synced so the taken server copy is not immediately pushed back.
		const hash = await index.computeHash(serverBody);
		await this.app.vault.process(pair.localFile, (current) =>
			`${this.extractFrontmatterBlock(current)}${serverBody}`);
		index.setEntry(pair.localFile.path, hash, hash);
		await index.save();
		new Notice(`Took server version of "${pair.localFile.basename}".`);
		this.refresh();
	}

	private extractFrontmatterBlock(content: string): string {
		if (!content.startsWith("---")) return "";
		const end = content.indexOf("\n---", 3);
		if (end === -1) return "";
		return content.slice(0, content.indexOf("\n", end + 1) + 1);
	}

	private refresh() {
		this.onChanged?.();
		void this.onOpen();
	}
}
