/**
 * Sync progress modal
 * Shows progress during sync operations
 */

import { App, Modal } from "obsidian";
import type { PullProgress } from "../sync";

export class SyncProgressModal extends Modal {
	private progressEl: HTMLElement | null = null;
	private messageEl: HTMLElement | null = null;
	private phaseEl: HTMLElement | null = null;
	private isComplete = false;
	private closeButton: HTMLButtonElement | null = null;

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("grimoire-sync-progress");

		contentEl.createEl("h2", { text: "Syncing with Grimoire" });

		this.phaseEl = contentEl.createEl("div", {
			cls: "grimoire-progress-phase",
			text: "Initializing...",
		});

		const progressContainer = contentEl.createDiv({ cls: "grimoire-progress-container" });
		const progressBar = progressContainer.createDiv({ cls: "grimoire-progress-bar" });
		this.progressEl = progressBar.createDiv({ cls: "grimoire-progress-fill" });

		this.messageEl = contentEl.createEl("div", {
			cls: "grimoire-progress-message",
			text: "Starting sync...",
		});

		// Create close button (initially hidden)
		const buttonContainer = contentEl.createDiv({ cls: "grimoire-progress-buttons" });
		this.closeButton = buttonContainer.createEl("button", {
			text: "Close",
			cls: "mod-cta",
		});
		this.closeButton.style.display = "none";
		this.closeButton.onclick = () => this.close();
	}

	/**
	 * Update progress display
	 */
	updateProgress(progress: PullProgress) {
		if (!this.progressEl || !this.messageEl || !this.phaseEl) return;

		// Update phase
		const phaseNames: Record<string, string> = {
			series: "Syncing Series",
			volumes: "Syncing Volumes",
			chapters: "Syncing Chapters",
		};
		this.phaseEl.setText(phaseNames[progress.phase] || progress.phase);

		// Update progress bar
		const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
		this.progressEl.style.width = `${percentage}%`;

		// Update message
		this.messageEl.setText(progress.message);
	}

	/**
	 * Show completion state
	 */
	showComplete(success: boolean, message: string) {
		this.isComplete = true;

		if (this.phaseEl) {
			this.phaseEl.setText(success ? "Sync Complete" : "Sync Failed");
			if (!success) {
				this.phaseEl.addClass("grimoire-error");
			}
		}

		if (this.progressEl) {
			this.progressEl.style.width = "100%";
			if (!success) {
				this.progressEl.addClass("grimoire-error");
			}
		}

		if (this.messageEl) {
			this.messageEl.setText(message);
		}

		if (this.closeButton) {
			this.closeButton.style.display = "block";
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
