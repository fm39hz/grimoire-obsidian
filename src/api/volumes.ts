/**
 * Volume API endpoints
 */

import type { ApiClient } from "./client";
import type {
	VolumeResponse,
	CreateVolumeRequest,
	UpdateVolumeRequest,
	PagedResult,
	ChapterListResponse,
} from "../types";

export class VolumesApi {
	constructor(private client: ApiClient) {}

	/**
	 * Get a list of all volumes with pagination
	 */
	async list(options?: {
		pageIndex?: number;
		pageSize?: number;
		sortBy?: string;
		sortDescending?: boolean;
	}): Promise<PagedResult<VolumeResponse>> {
		return this.client.get<PagedResult<VolumeResponse>>("/api/v1/volumes", {
			pageIndex: options?.pageIndex,
			pageSize: options?.pageSize,
			sortBy: options?.sortBy,
			sortDescending: options?.sortDescending,
		});
	}

	/**
	 * Get a single volume by ID
	 */
	async get(id: string, options?: { timestamp?: boolean }): Promise<VolumeResponse> {
		return this.client.get<VolumeResponse>(`/api/v1/volumes/${id}`, {
			timestamp: options?.timestamp,
		});
	}

	/**
	 * Create a new volume
	 */
	async create(data: CreateVolumeRequest): Promise<VolumeResponse> {
		return this.client.post<VolumeResponse>("/api/v1/volumes", data);
	}

	/**
	 * Update an existing volume
	 */
	async update(id: string, data: UpdateVolumeRequest): Promise<VolumeResponse> {
		return this.client.patch<VolumeResponse>(`/api/v1/volumes/${id}`, data);
	}

	/**
	 * Delete a volume
	 */
	async delete(id: string): Promise<boolean> {
		return this.client.delete<boolean>(`/api/v1/volumes/${id}`);
	}

	/**
	 * Get chapters for a volume.
	 * Backend may return either a direct array or a PagedResult.
	 */
	async getChapters(
		volumeId: string,
		options?: { pageIndex?: number; pageSize?: number }
	): Promise<ChapterListResponse[] | PagedResult<ChapterListResponse>> {
		return this.client.get<ChapterListResponse[] | PagedResult<ChapterListResponse>>(
			`/api/v1/volumes/${volumeId}/chapters`,
			{
				pageIndex: options?.pageIndex,
				pageSize: options?.pageSize,
			}
		);
	}

	/**
	 * Get all chapters for a volume (handles pagination if response is PagedResult)
	 */
	async getAllChapters(volumeId: string): Promise<ChapterListResponse[]> {
		const pageSize = 50;
		const first = await this.getChapters(volumeId, { pageIndex: 1, pageSize });

		if (Array.isArray(first)) {
			return first;
		}

		const all: ChapterListResponse[] = [...(first.items ?? [])];
		let pageIndex = 2;
		let current: PagedResult<ChapterListResponse> = first;

		while (current.hasNextPage) {
			current = await this.client.get<PagedResult<ChapterListResponse>>(
				`/api/v1/volumes/${volumeId}/chapters`,
				{ pageIndex, pageSize }
			);
			if (current.items) {
				all.push(...current.items);
			}
			pageIndex++;
		}

		return all;
	}
}
