/**
 * Base HTTP client using Obsidian's requestUrl
 */

import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
import type { ProblemDetails } from "../types";

export interface ApiClientConfig {
	baseUrl: string;
}

export class ApiError extends Error {
	constructor(
		public status: number,
		public problemDetails?: ProblemDetails,
		message?: string
	) {
		super(message || problemDetails?.detail || `API Error: ${status}`);
		this.name = "ApiError";
	}
}

export class ApiClient {
	private baseUrl: string;

	constructor(config: ApiClientConfig) {
		// Remove trailing slash if present
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
	}

	/**
	 * Update the base URL (e.g., when settings change)
	 */
	setBaseUrl(baseUrl: string): void {
		this.baseUrl = baseUrl.replace(/\/$/, "");
	}

	/**
	 * Make a GET request
	 */
	async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
		const url = this.buildUrl(path, params);
		return this.request<T>({ url, method: "GET" });
	}

	/**
	 * Make a POST request with JSON body
	 */
	async post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
		const url = this.buildUrl(path, params);
		return this.request<T>({
			url,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});
	}

	/**
	 * Make a PATCH request with JSON body
	 */
	async patch<T>(path: string, body?: unknown): Promise<T> {
		const url = this.buildUrl(path);
		return this.request<T>({
			url,
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});
	}

	/**
	 * Make a DELETE request
	 */
	async delete<T>(path: string): Promise<T> {
		const url = this.buildUrl(path);
		return this.request<T>({ url, method: "DELETE" });
	}

	/**
	 * Upload a file using multipart/form-data
	 */
	async uploadFile(path: string, file: ArrayBuffer, filename: string, params?: Record<string, string>): Promise<unknown> {
		const url = this.buildUrl(path, params);
		
		// Create form data boundary
		const boundary = "----ObsidianGrimoireSync" + Date.now().toString(16);
		
		// Build multipart body manually since Obsidian's requestUrl doesn't support FormData
		const encoder = new TextEncoder();
		const parts: Uint8Array[] = [];
		
		// Add file part
		const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
		parts.push(encoder.encode(header));
		parts.push(new Uint8Array(file));
		parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));
		
		// Combine all parts
		const totalLength = parts.reduce((acc, part) => acc + part.length, 0);
		const body = new Uint8Array(totalLength);
		let offset = 0;
		for (const part of parts) {
			body.set(part, offset);
			offset += part.length;
		}

		const response = await requestUrl({
			url,
			method: "POST",
			headers: {
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			body: body.buffer,
		});

		if (response.status >= 400) {
			throw new ApiError(response.status, response.json as ProblemDetails);
		}

		return response.json;
	}

	/**
	 * Download a file as ArrayBuffer
	 */
	async downloadFile(path: string): Promise<ArrayBuffer> {
		const url = this.buildUrl(path);
		const response = await requestUrl({
			url,
			method: "GET",
		});

		if (response.status >= 400) {
			throw new ApiError(response.status);
		}

		return response.arrayBuffer;
	}

	/**
	 * Build full URL with query parameters
	 */
	private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
		const url = new URL(path, this.baseUrl);
		
		if (params) {
			for (const [key, value] of Object.entries(params)) {
				if (value !== undefined) {
					url.searchParams.set(key, String(value));
				}
			}
		}

		return url.toString();
	}

	/**
	 * Make a request and handle response
	 */
	private async request<T>(options: RequestUrlParam): Promise<T> {
		try {
			const response: RequestUrlResponse = await requestUrl(options);
			
			if (response.status >= 400) {
				let problemDetails: ProblemDetails | undefined;
				try {
					problemDetails = response.json as ProblemDetails;
				} catch {
					// Response might not be JSON
				}
				throw new ApiError(response.status, problemDetails);
			}

			return response.json as T;
		} catch (error) {
			if (error instanceof ApiError) {
				throw error;
			}
			// Network or other error
			throw new Error(`Network error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}
}
