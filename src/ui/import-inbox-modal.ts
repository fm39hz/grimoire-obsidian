import { Modal, Notice, Setting } from "obsidian";
import type GrimoireSyncPlugin from "../main";
import type { ImportOperationDecisionDto, ImportRunResponseDto, PlanOperationDto } from "../types";
import { ResearchEvidenceModal } from "./research-evidence-modal";

export class ImportInboxModal extends Modal {
	constructor(private plugin: GrimoireSyncPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		this.modalEl.addClass("grimoire-import-inbox");
		void this.render();
	}

	private async render(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Import Inbox" });
		if (!this.plugin.api) {
			this.contentEl.createEl("p", { text: "Configure the Grimoire API first." });
			return;
		}
		this.contentEl.createEl("p", { cls: "setting-item-description", text: "Review reconciliation plans before they alter the editorial tree." });
		const loading = this.contentEl.createEl("p", { text: "Loading import runs…" });
		try {
			const runs = await this.plugin.api.imports.list();
			loading.remove();
			if (runs.length === 0) {
				this.contentEl.createEl("p", { text: "No import runs yet." });
				return;
			}
			for (const run of runs) this.renderRun(run);
		} catch (error) {
			loading.setText(error instanceof Error ? error.message : "Could not load import runs.");
			loading.addClass("grimoire-error");
		}
	}

	private renderRun(run: ImportRunResponseDto): void {
		const issueCount = run.plan?.issues.length ?? 0;
		const reviewCount = run.plan?.summary.review ?? 0;
		new Setting(this.contentEl)
			.setName(`${run.producerId} · ${run.status}`)
			.setDesc(`${new Date(run.startedAt).toLocaleString()} · ${reviewCount} review · ${issueCount} issue(s)`)
			.addButton(button => button.setButtonText("Review plan").onClick(() => {
				new PlanReviewModal(this.plugin, run, () => void this.render()).open();
			}))
			.addExtraButton(button => button.setIcon("search").setTooltip("Research evidence").onClick(() => {
				if (run.targetSeriesId) new ResearchEvidenceModal(this.plugin, run.targetSeriesId).open();
				else new Notice("This import has no resolved target series yet.");
			}));
	}
}

export class PlanReviewModal extends Modal {
	private decisions = new Map<string, "approve" | "reject">();

	constructor(
		private plugin: GrimoireSyncPlugin,
		private run: ImportRunResponseDto,
		private onChanged: () => void
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.modalEl.addClass("grimoire-plan-review");
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		const plan = this.run.plan;
		this.contentEl.createEl("h2", { text: `Plan ${this.run.id}` });
		if (!plan) {
			this.contentEl.createEl("p", { text: "This run has no plan." });
			return;
		}
		this.contentEl.createEl("p", {
			cls: "setting-item-description",
			text: `Target ${plan.targetSeriesId ?? "unresolved"} · base revision ${plan.baseSeriesRevision ?? "n/a"}`
		});

		if (plan.issues.length > 0) {
			const issues = this.contentEl.createDiv({ cls: "grimoire-plan-issues" });
			issues.createEl("h3", { text: "Conflicts and coverage issues" });
			for (const issue of plan.issues) {
				const row = issues.createDiv({ cls: "grimoire-plan-issue" });
				row.createEl("strong", { text: issue.code });
				row.createSpan({ text: ` — ${issue.message}` });
			}
		}

		const operations = this.contentEl.createDiv({ cls: "grimoire-plan-operations" });
		for (const operation of plan.operations) this.renderOperation(operations, operation);

		const actions = this.contentEl.createDiv({ cls: "grimoire-plan-actions" });
		if (plan.operations.some(operation => operation.disposition === "automatic" && operation.type !== "NoOp")) {
			new Setting(actions).setName("Apply safe operations").setDesc("Commits automatic operations and leaves review items pending.")
				.addButton(button => button.setButtonText("Commit safe").onClick(() => void this.commitSafe()));
		}
		new Setting(actions).setName("Commit reviewed plan").setDesc("Every review operation must be approved or rejected.")
			.addButton(button => button.setCta().setButtonText("Save decisions & commit").onClick(() => void this.commitReviewed()));
	}

	private renderOperation(parent: HTMLElement, operation: PlanOperationDto): void {
		const row = parent.createDiv({ cls: `grimoire-plan-operation disposition-${operation.disposition}` });
		const heading = row.createDiv({ cls: "grimoire-plan-operation-heading" });
		heading.createEl("strong", { text: operation.type });
		heading.createSpan({ cls: "grimoire-plan-badge", text: operation.disposition });
		row.createEl("div", { text: operation.sourceNode?.title ?? (operation.externalNodeKey || operation.targetNodeId || "Structure operation") });
		row.createEl("small", { text: operation.description });
		if (operation.disposition === "review") {
			new Setting(row).setName("Decision").addDropdown(dropdown => dropdown
				.addOption("", "Choose…")
				.addOption("approve", "Approve")
				.addOption("reject", "Reject")
				.onChange(value => {
					if (value === "approve" || value === "reject") this.decisions.set(operation.id, value);
					else this.decisions.delete(operation.id);
				}));
		}
	}

	private async commitSafe(): Promise<void> {
		if (!this.plugin.api) return;
		try {
			this.run = await this.plugin.api.imports.commitSafe(this.run.id);
			new Notice("Safe import operations committed.");
			this.onChanged();
			this.render();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Safe commit failed.");
		}
	}

	private async commitReviewed(): Promise<void> {
		if (!this.plugin.api || !this.run.plan) return;
		const reviewIds = this.run.plan.operations.filter(operation => operation.disposition === "review").map(operation => operation.id);
		if (reviewIds.some(id => !this.decisions.has(id))) {
			new Notice("Choose approve or reject for every review operation.");
			return;
		}
		const decisions: ImportOperationDecisionDto[] = reviewIds.map(operationId => ({
			operationId,
			choice: this.decisions.get(operationId)!
		}));
		try {
			await this.plugin.api.imports.saveDecisions(this.run.id, decisions);
			this.run = await this.plugin.api.imports.commit(this.run.id);
			new Notice("Reconciliation plan committed.");
			this.onChanged();
			this.close();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Commit failed.");
		}
	}
}
