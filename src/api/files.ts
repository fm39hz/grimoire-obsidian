/**
 * File/Asset API endpoints
 */

import type { ApiClient } from "./client";
import type { AssetResponse, AssetRefType } from "../types";

export class FilesApi {
	constructor(private client: ApiClient) {}

	/**
	 * Upload a file to a series
	 */
	async upload(
		seriesId: string,
		file: ArrayBuffer,
		filename: string,
		refType: AssetRefType = "Content"
	): Promise<AssetResponse> {
		return this.client.uploadFile(
			`/api/v1/files/upload/${seriesId}`,
			file,
			filename,
			{ refType }
		) as Promise<AssetResponse>;
	}

	/**
	 * Download a file by asset ID
	 */
	async download(assetId: string): Promise<ArrayBuffer> {
		return this.client.downloadFile(`/api/v1/files/${assetId}`);
	}

	/**
	 * Delete a file by asset ID
	 */
	async delete(assetId: string): Promise<void> {
		await this.client.delete(`/api/v1/files/${assetId}`);
	}

	/**
	 * Get the URL for an asset (for embedding in markdown)
	 */
	getAssetUrl(baseUrl: string, assetId: string): string {
		return `${baseUrl.replace(/\/$/, "")}/api/v1/files/${assetId}`;
	}
}
