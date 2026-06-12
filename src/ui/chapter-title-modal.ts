import { App, Modal, Setting, Notice } from "obsidian";

export class ChapterTitleModal extends Modal {
	private title: string = "";
	private onSubmit: (title: string) => void;

	constructor(app: App, defaultTitle: string, onSubmit: (title: string) => void) {
		super(app);
		this.title = defaultTitle;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Enter new chapter title" });

		new Setting(contentEl)
			.setName("Title")
			.addText((text: any) =>
				text
					.setValue(this.title)
					.onChange((value: string) => {
						this.title = value;
					})
			);

		new Setting(contentEl)
			.addButton((btn: any) =>
				btn
					.setButtonText("Split")
					.setCta()
					.onClick(() => {
						if (this.title.trim()) {
							this.onSubmit(this.title.trim());
							this.close();
						} else {
							new Notice("Please enter a title");
						}
					})
			)
			.addButton((btn: any) =>
				btn
					.setButtonText("Cancel")
					.onClick(() => {
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
