import type { ApiClient } from "./client";
import type { ResearchEvidenceDto, SeriesResearchProfileDto } from "../types";

export class ResearchApi {
	constructor(private client: ApiClient) {}

	get(seriesId: string): Promise<SeriesResearchProfileDto> {
		return this.client.get<SeriesResearchProfileDto>(`/api/v1/series/${seriesId}/research`);
	}

	refresh(seriesId: string, force = false): Promise<SeriesResearchProfileDto> {
		return this.client.post<SeriesResearchProfileDto>(`/api/v1/series/${seriesId}/research`, undefined, { force });
	}

	confirm(seriesId: string, evidence: ResearchEvidenceDto[]): Promise<SeriesResearchProfileDto> {
		return this.client.patch<SeriesResearchProfileDto>(`/api/v1/series/${seriesId}/research/evidence`, { evidence });
	}
}
