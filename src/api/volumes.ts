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
	async get(id: string): Promise<VolumeResponse> {
		return this.client.get<VolumeResponse>(`/api/v1/volumes/${id}`);
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
	 * Get chapters for a volume
	 */
	async getChapters(
		volumeId: string,
		options?: {
			pageIndex?: number;
			pageSize?: number;
			sortBy?: string;
			sortDescending?: boolean;
		}
	): Promise<PagedResult<ChapterListResponse>> {
		return this.client.get<PagedResult<ChapterListResponse>>(`/api/v1/volumes/${volumeId}/chapters`, {
			pageIndex: options?.pageIndex,
			pageSize: options?.pageSize,
			sortBy: options?.sortBy,
			sortDescending: options?.sortDescending,
		});
	}

	/**
	 * Get all chapters for a volume
	 */
	async getAllChapters(volumeId: string): Promise<ChapterListResponse[]> {
		const allChapters: ChapterListResponse[] = [];
		let pageIndex = 1;
		const pageSize = 50;

		while (true) {
			const result = await this.getChapters(volumeId, { pageIndex, pageSize });
			if (result.items) {
				allChapters.push(...result.items);
			}
			if (!result.hasNextPage) {
				break;
			}
			pageIndex++;
		}

		return allChapters;
	}
}
