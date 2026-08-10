import { Modal, Notice, Setting } from "obsidian";
import type GrimoireSyncPlugin from "../main";
import type { SeriesResearchProfileDto } from "../types";

export class ResearchEvidenceModal extends Modal {
	constructor(private plugin: GrimoireSyncPlugin, private seriesId: string) {
		super(plugin.app);
	}

	onOpen(): void {
		this.modalEl.addClass("grimoire-research-evidence");
		void this.load(false);
	}

	private async load(refresh: boolean): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Research evidence" });
		const loading = this.contentEl.createEl("p", { text: refresh ? "Searching providers…" : "Loading profile…" });
		if (!this.plugin.api) return;
		try {
			const profile = refresh
				? await this.plugin.api.research.refresh(this.seriesId, true)
				: await this.plugin.api.research.get(this.seriesId);
			loading.remove();
			this.render(profile);
		} catch (error) {
			loading.setText(error instanceof Error ? error.message : "Research profile is unavailable.");
			new Setting(this.contentEl).addButton(button => button.setButtonText("Research now").onClick(() => void this.load(true)));
		}
	}

	private render(profile: SeriesResearchProfileDto): void {
		new Setting(this.contentEl).setName("Refresh external evidence")
			.setDesc("Open Library and Google Books failures never block import.")
			.addButton(button => button.setButtonText("Refresh").onClick(() => void this.load(true)));
		const evidence = this.contentEl.createDiv({ cls: "grimoire-research-list" });
		evidence.createEl("h3", { text: "Evidence" });
		for (const item of profile.evidence) {
			const row = evidence.createDiv({ cls: "grimoire-research-row" });
			row.createEl("strong", { text: `${item.field}: ${item.value}` });
			row.createEl("small", { text: `${item.source} · ${Math.round(item.confidence * 100)}%${item.confirmed ? " · confirmed" : ""}` });
		}
		const sources = this.contentEl.createDiv({ cls: "grimoire-research-list" });
		sources.createEl("h3", { text: "Discovered sources" });
		for (const source of profile.discoveredSources) {
			const link = sources.createEl("a", { text: source.title ?? source.uri, href: source.uri });
			link.setAttr("target", "_blank");
			sources.createEl("small", { text: ` ${source.relation ?? "source"} · ${source.provider}` });
			sources.createEl("br");
		}
		for (const error of profile.providerErrors) {
			this.contentEl.createEl("p", { cls: "grimoire-provider-error", text: error });
		}
	}
}
