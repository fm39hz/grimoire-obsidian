/**
 * Series API endpoints
 */

import type { ApiClient } from "./client";
import type {
	SeriesResponse,
	ContentResponseDto,
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
	}): Promise<PagedResult<SeriesResponse>> {
		return this.client.get<PagedResult<SeriesResponse>>("/api/v1/series", {
			pageIndex: options?.pageIndex,
			pageSize: options?.pageSize,
			sortBy: options?.sortBy,
			sortDescending: options?.sortDescending,
		});
	}

	/**
	 * Get all series (handles pagination automatically)
	 */
	async listAll(): Promise<SeriesResponse[]> {
		const allSeries: SeriesResponse[] = [];
		let pageIndex = 1;
		const pageSize = 50;

		while (true) {
			const result = await this.list({ pageIndex, pageSize });
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
	async get(id: string, options?: { timestamp?: boolean }): Promise<SeriesResponse> {
		return this.client.get<SeriesResponse>(`/api/v1/series/${id}`, {
			timestamp: options?.timestamp,
		});
	}

	/**
	 * Get series content in the specified format
	 */
	async getContent(id: string, format: string = "markdown"): Promise<ContentResponseDto> {
		return this.client.get<ContentResponseDto>(`/api/v1/series/${id}/content`, {
			format
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
	 * Get volumes for a series.
	 * Backend may return either a direct array or a PagedResult.
	 */
	async getVolumes(seriesId: string): Promise<VolumeResponse[]> {
		const result = await this.client.get<VolumeResponse[] | PagedResult<VolumeResponse>>(
			`/api/v1/series/${seriesId}/volumes`
		);
		if (Array.isArray(result)) {
			return result;
		}
		return result.items ?? [];
	}

	/**
	 * Get all volumes for a series
	 */
	async getAllVolumes(seriesId: string): Promise<VolumeResponse[]> {
		return this.getVolumes(seriesId);
	}
}
