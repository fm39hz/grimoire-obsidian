import type { ApiClient } from "./client";
import type { ImportOperationDecisionDto, ImportRunResponseDto, ReconciliationPlanDto } from "../types";

export class ImportsApi {
	constructor(private client: ApiClient) {}

	list(limit = 50): Promise<ImportRunResponseDto[]> {
		return this.client.get<ImportRunResponseDto[]>("/api/v1/imports", { limit });
	}

	get(id: string): Promise<ImportRunResponseDto> {
		return this.client.get<ImportRunResponseDto>(`/api/v1/imports/${id}`);
	}

	getPlan(id: string): Promise<ReconciliationPlanDto> {
		return this.client.get<ReconciliationPlanDto>(`/api/v1/imports/${id}/plan`);
	}

	saveDecisions(id: string, decisions: ImportOperationDecisionDto[]): Promise<ImportRunResponseDto> {
		return this.client.patch<ImportRunResponseDto>(`/api/v1/imports/${id}/decisions`, { decisions });
	}

	commit(id: string): Promise<ImportRunResponseDto> {
		return this.client.post<ImportRunResponseDto>(`/api/v1/imports/${id}/commit`);
	}

	commitSafe(id: string): Promise<ImportRunResponseDto> {
		return this.client.post<ImportRunResponseDto>(`/api/v1/imports/${id}/commit-safe`);
	}
}
