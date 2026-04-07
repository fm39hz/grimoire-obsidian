/**
 * Chapter API endpoints
 */

import type { ApiClient } from "./client";
import type {
	ChapterResponse,
	ChapterListResponse,
	CreateChapterRequest,
	UpdateChapterRequest,
	SplitChapterRequest,
	PagedResult,
} from "../types";

export class ChaptersApi {
	constructor(private client: ApiClient) {}

	/**
	 * Get a list of all chapters with pagination
	 */
	async list(options?: {
		pageIndex?: number;
		pageSize?: number;
		sortBy?: string;
		sortDescending?: boolean;
	}): Promise<PagedResult<ChapterListResponse>> {
		return this.client.get<PagedResult<ChapterListResponse>>("/api/v1/chapters", {
			pageIndex: options?.pageIndex,
			pageSize: options?.pageSize,
			sortBy: options?.sortBy,
			sortDescending: options?.sortDescending,
		});
	}

	/**
	 * Get a single chapter by ID (includes full content)
	 */
	async get(id: string, options?: { markdown?: boolean; timestamp?: boolean }): Promise<ChapterResponse> {
		return this.client.get<ChapterResponse>(`/api/v1/chapters/${id}`, {
			markdown: options?.markdown,
			timestamp: options?.timestamp,
		});
	}

	/**
	 * Create a new chapter
	 */
	async create(data: CreateChapterRequest): Promise<ChapterResponse> {
		return this.client.post<ChapterResponse>("/api/v1/chapters", data);
	}

	/**
	 * Update an existing chapter
	 */
	async update(id: string, data: UpdateChapterRequest): Promise<ChapterResponse> {
		return this.client.patch<ChapterResponse>(`/api/v1/chapters/${id}`, data);
	}

	/**
	 * Delete a chapter
	 */
	async delete(id: string): Promise<boolean> {
		return this.client.delete<boolean>(`/api/v1/chapters/${id}`);
	}

	/**
	 * Split a chapter into multiple chapters
	 */
	async split(id: string, data: SplitChapterRequest): Promise<ChapterResponse[]> {
		return this.client.post<ChapterResponse[]>(`/api/v1/chapters/${id}/split`, data);
	}
}
