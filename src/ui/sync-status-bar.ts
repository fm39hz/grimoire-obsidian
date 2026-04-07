/**
 * Sync status bar item
 * Shows sync status in Obsidian's status bar
 */

import type { SyncState } from "../types";

export class SyncStatusBar {
	private statusBarEl: HTMLElement;

	constructor(statusBarEl: HTMLElement) {
		this.statusBarEl = statusBarEl;
		this.statusBarEl.addClass("grimoire-status-bar");
		this.update({ status: "idle" });
	}

	/**
	 * Update the status bar display
	 */
	update(state: SyncState) {
		this.statusBarEl.empty();

		const icon = this.statusBarEl.createSpan({ cls: "grimoire-status-icon" });
		const text = this.statusBarEl.createSpan({ cls: "grimoire-status-text" });

		switch (state.status) {
			case "idle":
				icon.setText("📚");
				text.setText("Grimoire: Ready");
				this.statusBarEl.removeClass("grimoire-syncing", "grimoire-error");
				break;

			case "pulling":
				icon.setText("⬇️");
				text.setText(state.progress?.message || "Grimoire: Pulling...");
				this.statusBarEl.addClass("grimoire-syncing");
				this.statusBarEl.removeClass("grimoire-error");
				break;

			case "pushing":
				icon.setText("⬆️");
				text.setText(state.progress?.message || "Grimoire: Pushing...");
				this.statusBarEl.addClass("grimoire-syncing");
				this.statusBarEl.removeClass("grimoire-error");
				break;

			case "error":
				icon.setText("❌");
				text.setText(`Grimoire: Error - ${state.error || "Unknown"}`);
				this.statusBarEl.addClass("grimoire-error");
				this.statusBarEl.removeClass("grimoire-syncing");
				break;
		}
	}

	/**
	 * Show a temporary message
	 */
	showMessage(message: string, duration = 3000) {
		const originalState = this.statusBarEl.innerHTML;
		this.statusBarEl.setText(`📚 ${message}`);

		setTimeout(() => {
			// Only restore if not changed by something else
			if (this.statusBarEl.getText().includes(message)) {
				this.statusBarEl.innerHTML = originalState;
			}
		}, duration);
	}
}
