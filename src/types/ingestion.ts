export type PlanDisposition = "automatic" | "review" | "reject";

export interface MatchEvidence {
	rule: string;
	score: number;
	description: string;
}

export interface SourceNodeDto {
	externalKey: string;
	kind: "container" | "content" | "asset";
	title: string;
	targetId?: string | null;
	logicalKey?: string | null;
	roleHint?: string | null;
	orderHint?: number | null;
}

export interface PlanOperationDto {
	id: string;
	type: string;
	disposition: PlanDisposition;
	externalNodeKey: string;
	targetNodeId?: string | null;
	description: string;
	evidence?: MatchEvidence[] | null;
	parentTargetId?: string | null;
	parentOperationId?: string | null;
	sourceNode?: SourceNodeDto | null;
	previousTargetId?: string | null;
	nextTargetId?: string | null;
}

export interface PlanIssueDto {
	code: string;
	message: string;
	externalNodeKey?: string | null;
}

export interface ReconciliationPlanDto {
	importRunId: string;
	targetSeriesId?: string | null;
	baseSeriesRevision?: number | null;
	operations: PlanOperationDto[];
	issues: PlanIssueDto[];
	summary: { automatic: number; review: number; rejected: number; noOp: number };
}

export interface ImportRunResponseDto {
	id: string;
	status: string;
	producerId: string;
	idempotencyKey: string;
	targetSeriesId?: string | null;
	baseSeriesRevision?: number | null;
	startedAt: string;
	analyzedAt?: string | null;
	plan?: ReconciliationPlanDto | null;
}

export interface ImportOperationDecisionDto {
	operationId: string;
	choice: "approve" | "reject";
	note?: string | null;
}

export interface ResearchEvidenceDto {
	field: string;
	value: string;
	source: string;
	uri?: string | null;
	confidence: number;
	confirmed: boolean;
	observedAt?: string | null;
}

export interface ResearchCandidateDto {
	provider: string;
	externalKey: string;
	kind: string;
	title: string;
	authors: string[];
	isbns: string[];
	firstPublishedYear?: number | null;
	uri?: string | null;
	confidence: number;
}

export interface DiscoveredSourceDto {
	uri: string;
	provider: string;
	relation?: string | null;
	title?: string | null;
	confidence: number;
}

export interface SeriesResearchProfileDto {
	seriesId: string;
	revision: number;
	aliases: string[];
	creators: string[];
	evidence: ResearchEvidenceDto[];
	candidates: ResearchCandidateDto[];
	discoveredSources: DiscoveredSourceDto[];
	providerErrors: string[];
	updatedAt: string;
}
