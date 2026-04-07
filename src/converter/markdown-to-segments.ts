/**
 * Convert markdown content to API segments
 * Handles parsing markdown formatting to TextSegment/TextRun structure
 */

import type { Segment, TextSegment, TextRun, FootnoteSegment } from "../types";
import { parseMarkdownFootnotes, markdownFootnotesToSegments, parseTextToRuns } from "./footnotes";

/**
 * Result of parsing markdown to segments
 */
export interface ParsedContent {
	segments: Segment[];
	footnotes: FootnoteSegment[];
}

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * Convert markdown content to API segment format
 */
export function markdownToSegments(markdown: string): ParsedContent {
	// First, extract footnote definitions
	const { content, footnotes: footnoteMap } = parseMarkdownFootnotes(markdown);

	// Split content into paragraphs (separated by blank lines)
	const paragraphs = content.split(/\n\n+/).filter((p) => p.trim());

	// Convert each paragraph to a TextSegment
	const segments: Segment[] = paragraphs.map((paragraph) => {
		return paragraphToSegment(paragraph, footnoteMap);
	});

	// Convert footnotes map to FootnoteSegment array
	const footnotes = markdownFootnotesToSegments(footnoteMap);

	return { segments, footnotes };
}

/**
 * Convert a single paragraph to a TextSegment
 */
function paragraphToSegment(paragraph: string, footnotes: Map<string, string>): TextSegment {
	// Normalize whitespace within paragraph (keep single newlines as spaces)
	const normalizedText = paragraph.replace(/\n/g, " ").trim();

	// Parse text with formatting and footnote references
	const runs = parseTextWithFootnotes(normalizedText, footnotes);

	return {
		id: generateUUID(),
		runs,
	};
}

/**
 * Parse text that may contain formatting and footnote references
 */
function parseTextWithFootnotes(text: string, footnotes: Map<string, string>): TextRun[] {
	// First, identify footnote references and split text around them
	const footnoteRefRegex = /\[\^([^\]]+)\]/g;

	interface TextPart {
		text: string;
		footnoteId?: string;
	}

	const parts: TextPart[] = [];
	let lastIndex = 0;
	let match = footnoteRefRegex.exec(text);

	while (match !== null) {
		// Add text before the footnote reference
		if (match.index > lastIndex) {
			parts.push({ text: text.slice(lastIndex, match.index) });
		}

		// Add a marker for the footnote (the preceding word will get the footnoteId)
		const footnoteId = match[1];
		if (footnoteId && footnotes.has(footnoteId)) {
			// We'll attach the footnote to the previous part or create an empty marker
			if (parts.length > 0) {
				const lastPart = parts[parts.length - 1];
				if (lastPart && !lastPart.footnoteId) {
					lastPart.footnoteId = footnoteId;
				} else {
					parts.push({ text: "", footnoteId });
				}
			} else {
				parts.push({ text: "", footnoteId });
			}
		}

		lastIndex = match.index + match[0].length;
		match = footnoteRefRegex.exec(text);
	}

	// Add remaining text
	if (lastIndex < text.length) {
		parts.push({ text: text.slice(lastIndex) });
	}

	// Now parse each part for formatting
	const runs: TextRun[] = [];

	for (const part of parts) {
		if (part.text) {
			const formattedRuns = parseTextToRuns(part.text);
			// Attach footnoteId to the last run of this part
			if (part.footnoteId && formattedRuns.length > 0) {
				const lastRun = formattedRuns[formattedRuns.length - 1];
				if (lastRun) {
					lastRun.footnoteId = part.footnoteId;
				}
			}
			runs.push(...formattedRuns);
		} else if (part.footnoteId) {
			// Empty text with footnote - create a minimal run
			runs.push({ text: "", isBold: false, isItalic: false, footnoteId: part.footnoteId });
		}
	}

	return runs;
}

/**
 * Convert markdown description to TextSegment array for series metadata
 */
export function markdownToDescription(markdown: string): TextSegment[] {
	const { segments } = markdownToSegments(markdown);
	return segments as TextSegment[];
}
