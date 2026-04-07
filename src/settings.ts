/**
 * Plugin settings interface and settings tab
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type GrimoireSyncPlugin from "./main";

export interface GrimoireSyncSettings {
	/** Base URL of the Grimoire API (e.g., https://api.example.com) */
	apiBaseUrl: string;
	/** Root folder in the vault for synced content */
	syncFolder: string;
	/** Automatically create folder structure during sync */
	autoCreateFolders: boolean;
}

export const DEFAULT_SETTINGS: GrimoireSyncSettings = {
	apiBaseUrl: "",
	syncFolder: "Books",
	autoCreateFolders: true,
};

export class GrimoireSyncSettingTab extends PluginSettingTab {
	plugin: GrimoireSyncPlugin;

	constructor(app: App, plugin: GrimoireSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		;

		// API Base URL
		new Setting(containerEl)
			.setName("API base URL")
			.setDesc("The base URL of your Grimoire backend API (e.g., https://api.example.com)")
			.addText((text) =>
				text
					.setPlaceholder("https://api.example.com")
					.setValue(this.plugin.settings.apiBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiBaseUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// Sync Folder
		new Setting(containerEl)
			.setName("Sync folder")
			.setDesc("The root folder in your vault where synced content will be stored")
			.addText((text) =>
				text
					.setPlaceholder("Books")
					.setValue(this.plugin.settings.syncFolder)
					.onChange(async (value) => {
						this.plugin.settings.syncFolder = value.trim() || "Books";
						await this.plugin.saveSettings();
					})
			);

		// Auto-create folders
		new Setting(containerEl)
			.setName("Auto-create folders")
			.setDesc("Automatically create the folder structure (Series/Volume) during sync")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoCreateFolders)
					.onChange(async (value) => {
						this.plugin.settings.autoCreateFolders = value;
						await this.plugin.saveSettings();
					})
			);

		// Connection test section
		new Setting(containerEl).setName("Connection").setHeading();

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Verify that the API is reachable")
			.addButton((button) =>
				button
					.setButtonText("Test")
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText("Testing...");
						try {
							await this.plugin.testConnection();
							button.setButtonText("Success!");
							setTimeout(() => {
								button.setButtonText("Test");
								button.setDisabled(false);
							}, 2000);
						} catch (error) {
							button.setButtonText("Failed");
							setTimeout(() => {
								button.setButtonText("Test");
								button.setDisabled(false);
							}, 2000);
						}
					})
			);
	}
}
