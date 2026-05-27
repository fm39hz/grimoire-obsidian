import type { ApiClient } from "./client";
import type { BinderyRequest } from "../types";

export class BinderyApi {
	constructor(private client: ApiClient) {}

	async create(
		seriesId: string,
		data: BinderyRequest
	): Promise<void> {
		await this.client.post<void>("/api/v1/binderies", data, { seriesId });
	}
}
