/**
 * Series selection modal
 * Allows user to select which series to pull from the API
 */

import { App, Modal, Setting } from "obsidian";
import type { SeriesResponse } from "../types";

export class SeriesSelectionModal extends Modal {
	private series: SeriesResponse[];
	private onSelect: (series: SeriesResponse | null) => void;
	private selectedSeries: SeriesResponse | null = null;

	constructor(
		app: App,
		series: SeriesResponse[],
		onSelect: (series: SeriesResponse | null) => void
	) {
		super(app);
		this.series = series;
		this.onSelect = onSelect;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Select a series to pull" });

		if (this.series.length === 0) {
			contentEl.createEl("p", { text: "No series found on the server." });
			new Setting(contentEl).addButton((btn) =>
				btn.setButtonText("Close").onClick(() => {
					this.close();
					this.onSelect(null);
				})
			);
			return;
		}

		// Create a list of series as radio buttons
		const listContainer = contentEl.createDiv({ cls: "grimoire-series-list" });

		for (const series of this.series) {
			if (!series.id) continue;

			const itemEl = listContainer.createDiv({ cls: "grimoire-series-item" });

			new Setting(itemEl)
				.setName(series.title || "Untitled")
				.setDesc(this.getSeriesDescription(series))
				.addButton((btn) =>
					btn
						.setButtonText("Select")
						.setCta()
						.onClick(() => {
							this.selectedSeries = series;
							this.close();
							this.onSelect(series);
						})
				);
		}

		// Add cancel button
		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
					this.onSelect(null);
				})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Pull all series")
					.setCta()
					.onClick(() => {
						this.close();
						// Return a special marker to indicate "all series"
						this.onSelect({ id: "__ALL__", title: "All Series" } as SeriesResponse);
					})
			);
	}

	private getSeriesDescription(series: SeriesResponse): string {
		const parts: string[] = [];

		if (series.metadata?.authors && series.metadata.authors.length > 0) {
			parts.push(`By: ${series.metadata.authors.join(", ")}`);
		}

		if (series.metadata?.tags && series.metadata.tags.length > 0) {
			parts.push(`Tags: ${series.metadata.tags.slice(0, 3).join(", ")}`);
		}

		return parts.join(" | ") || "No description";
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
