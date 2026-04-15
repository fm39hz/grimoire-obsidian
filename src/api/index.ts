/**
 * API module index - Exports unified API interface
 */

import { ApiClient, ApiClientConfig } from "./client";
import { SeriesApi } from "./series";
import { VolumesApi } from "./volumes";
import { ChaptersApi } from "./chapters";
import { FilesApi } from "./files";

export { ApiClient, ApiError } from "./client";
export type { ApiClientConfig } from "./client";
export { SeriesApi } from "./series";
export { VolumesApi } from "./volumes";
export { ChaptersApi } from "./chapters";
export { FilesApi } from "./files";

/**
 * Unified API interface providing access to all endpoints
 */
export class GrimoireApi {
	private client: ApiClient;
	
	public readonly series: SeriesApi;
	public readonly volumes: VolumesApi;
	public readonly chapters: ChaptersApi;
	public readonly files: FilesApi;

	constructor(config: ApiClientConfig) {
		this.client = new ApiClient(config);
		this.series = new SeriesApi(this.client);
		this.volumes = new VolumesApi(this.client);
		this.chapters = new ChaptersApi(this.client);
		this.files = new FilesApi(this.client);
	}

	/**
	 * Update the API base URL
	 */
	setBaseUrl(baseUrl: string): void {
		this.client.setBaseUrl(baseUrl);
	}

	/**
	 * Get the current base URL
	 */
	get baseUrl(): string {
		return (this.client as unknown as { baseUrl: string }).baseUrl;
	}
}
