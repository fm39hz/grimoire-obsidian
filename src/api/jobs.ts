import type { ApiClient } from "./client";
import type { JobResponse } from "../types";

export class JobsApi {
	constructor(private client: ApiClient) {}

	async get(jobId: string): Promise<JobResponse> {
		return this.client.get<JobResponse>(`/api/v1/jobs/${jobId}`);
	}

	async download(jobId: string): Promise<ArrayBuffer> {
		return this.client.downloadFile(`/api/v1/jobs/${jobId}/download`);
	}
}
