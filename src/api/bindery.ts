import type { ApiClient } from "./client";
import type { BinderyRequest, JobResponse, CreateSeriesRequest } from "../types";

export class BinderyApi {
	constructor(private client: ApiClient) {}

	/**
	 * Export a series to ebook (EPUB, PDF, etc.)
	 */
	async create(
		seriesId: string,
		data: BinderyRequest
	): Promise<JobResponse> {
		return this.client.post<JobResponse>(`/api/v1/publishes/series/${seriesId}/export`, data);
	}

	/**
	 * Import a book from EPUB file
	 */
	async importBook(
		series: CreateSeriesRequest,
		file: ArrayBuffer,
		filename: string,
		volumes?: string
	): Promise<JobResponse> {
		return this.client.importBook(
			"/api/v1/publishes/import",
			file,
			filename,
			JSON.stringify(series),
			volumes
		);
	}
}
