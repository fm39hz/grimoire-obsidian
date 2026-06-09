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
	/** Subfolder name within each series folder for storing pulled images */
	imagesFolder: string;
	/** Enable auto sync */
	enableAutoSync: boolean;
	/** Run sync on startup */
	syncOnStartup: boolean;
	/** Periodic sync interval in minutes */
	syncIntervalMinutes: number;
}

export const DEFAULT_SETTINGS: GrimoireSyncSettings = {
	apiBaseUrl: "",
	syncFolder: "Books",
	autoCreateFolders: true,
	imagesFolder: "images",
	enableAutoSync: false,
	syncOnStartup: false,
	syncIntervalMinutes: 15,
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

		// Images folder name
		new Setting(containerEl)
			.setName("Images folder")
			.setDesc("Subfolder name inside each series folder for storing pulled images. Set to match Obsidian's attachment subfolder setting for consistent paths.")
			.addText((text) =>
				text
					.setPlaceholder("images")
					.setValue(this.plugin.settings.imagesFolder)
					.onChange(async (value) => {
						this.plugin.settings.imagesFolder = value.trim() || "images";
						await this.plugin.saveSettings();
					})
			);

		// Auto Sync Section
		new Setting(containerEl).setName("Auto sync settings").setHeading();

		new Setting(containerEl)
			.setName("Enable auto-sync")
			.setDesc("Automatically sync content in the background")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableAutoSync)
					.onChange(async (value) => {
						this.plugin.settings.enableAutoSync = value;
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide other auto-sync options
					})
			);

		if (this.plugin.settings.enableAutoSync) {
			new Setting(containerEl)
				.setName("Sync on startup")
				.setDesc("Run a sync automatically when Obsidian opens")
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.syncOnStartup)
						.onChange(async (value) => {
							this.plugin.settings.syncOnStartup = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Sync interval (minutes)")
				.setDesc("Minutes to wait between background syncs")
				.addText((text) =>
					text
						.setPlaceholder("15")
						.setValue(String(this.plugin.settings.syncIntervalMinutes))
						.onChange(async (value) => {
							const mins = parseInt(value, 10);
							if (!isNaN(mins) && mins > 0) {
								this.plugin.settings.syncIntervalMinutes = mins;
								await this.plugin.saveSettings();
							}
						})
				);
		}

		// Sync actions section
		new Setting(containerEl).setName("Sync").setHeading();

		new Setting(containerEl)
			.setName("Pull all series")
			.setDesc("Download all series, volumes, and chapters from Grimoire")
			.addButton((button) =>
				button
					.setButtonText("Pull all")
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText("Pulling...");
						try {
							await this.plugin.pullAll();
							button.setButtonText("Done!");
							setTimeout(() => {
								button.setButtonText("Pull all");
								button.setDisabled(false);
							}, 2000);
						} catch {
							button.setButtonText("Failed");
							setTimeout(() => {
								button.setButtonText("Pull all");
								button.setDisabled(false);
							}, 2000);
						}
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
