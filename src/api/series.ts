/**
 * Series API endpoints
 */

import type { ApiClient } from "./client";
import type {
	SeriesResponse,
	CreateSeriesRequest,
	UpdateSeriesRequest,
	PagedResult,
	VolumeResponse,
} from "../types";

export class SeriesApi {
	constructor(private client: ApiClient) {}

	/**
	 * Get a list of all series with pagination
	 */
	async list(options?: {
		pageIndex?: number;
		pageSize?: number;
		sortBy?: string;
		sortDescending?: boolean;
		markdown?: boolean;
	}): Promise<PagedResult<SeriesResponse>> {
		return this.client.get<PagedResult<SeriesResponse>>("/api/v1/series", {
			pageIndex: options?.pageIndex,
			pageSize: options?.pageSize,
			sortBy: options?.sortBy,
			sortDescending: options?.sortDescending,
			markdown: options?.markdown,
		});
	}

	/**
	 * Get all series (handles pagination automatically)
	 */
	async listAll(options?: { markdown?: boolean }): Promise<SeriesResponse[]> {
		const allSeries: SeriesResponse[] = [];
		let pageIndex = 1;
		const pageSize = 50;

		while (true) {
			const result = await this.list({ pageIndex, pageSize, markdown: options?.markdown });
			if (result.items) {
				allSeries.push(...result.items);
			}
			if (!result.hasNextPage) {
				break;
			}
			pageIndex++;
		}

		return allSeries;
	}

	/**
	 * Get a single series by ID
	 */
	async get(id: string, options?: { markdown?: boolean; timestamp?: boolean }): Promise<SeriesResponse> {
		return this.client.get<SeriesResponse>(`/api/v1/series/${id}`, {
			markdown: options?.markdown,
			timestamp: options?.timestamp,
		});
	}

	/**
	 * Create a new series
	 */
	async create(data: CreateSeriesRequest): Promise<SeriesResponse> {
		return this.client.post<SeriesResponse>("/api/v1/series", data);
	}

	/**
	 * Update an existing series
	 */
	async update(id: string, data: UpdateSeriesRequest): Promise<SeriesResponse> {
		return this.client.patch<SeriesResponse>(`/api/v1/series/${id}`, data);
	}

	/**
	 * Delete a series
	 */
	async delete(id: string): Promise<boolean> {
		return this.client.delete<boolean>(`/api/v1/series/${id}`);
	}

	/**
	 * Get volumes for a series
	 */
	async getVolumes(
		seriesId: string,
		options?: {
			pageIndex?: number;
			pageSize?: number;
			sortBy?: string;
			sortDescending?: boolean;
		}
	): Promise<PagedResult<VolumeResponse>> {
		return this.client.get<PagedResult<VolumeResponse>>(`/api/v1/series/${seriesId}/volumes`, {
			pageIndex: options?.pageIndex,
			pageSize: options?.pageSize,
			sortBy: options?.sortBy,
			sortDescending: options?.sortDescending,
		});
	}

	/**
	 * Get all volumes for a series (handles pagination)
	 */
	async getAllVolumes(seriesId: string): Promise<VolumeResponse[]> {
		const allVolumes: VolumeResponse[] = [];
		let pageIndex = 1;
		const pageSize = 50;

		while (true) {
			const result = await this.getVolumes(seriesId, { pageIndex, pageSize });
			if (result.items) {
				allVolumes.push(...result.items);
			}
			if (!result.hasNextPage) {
				break;
			}
			pageIndex++;
		}

		return allVolumes;
	}
}
