import { App, Modal } from "obsidian";

export interface VolumeOption {
	id: string;
	title: string;
}

/**
 * Minimal picker listing candidate target volumes for a "move chapter" operation.
 */
export class VolumePickerModal extends Modal {
	constructor(
		app: App,
		private options: VolumeOption[],
		private onPick: (target: VolumeOption) => Promise<void>
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Move to volume…" });

		const list = contentEl.createDiv({ cls: "grimoire-volume-picker" });
		for (const option of this.options) {
			const button = list.createEl("button", { text: option.title, cls: "grimoire-volume-option" });
			button.addEventListener("click", () => {
				this.close();
				void this.onPick(option);
			});
		}

		contentEl.createDiv({ cls: "grimoire-conflict-buttons" }, (el) => {
			el.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
