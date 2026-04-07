/**
 * Convert API segments to markdown content
 * Handles TextSegment, TextRun formatting, and footnote references
 */

import type { Segment, TextSegment, TextRun, FootnoteSegment } from "../types";
import { footnotesToMarkdown } from "./footnotes";

/**
 * Check if a segment is a TextSegment
 */
function isTextSegment(segment: Segment): segment is TextSegment {
	return "runs" in segment;
}

/**
 * Convert a chapter's content segments and footnotes to markdown
 */
export function segmentsToMarkdown(
	segments: Segment[] | null,
	footnotes: FootnoteSegment[] | null
): string {
	if (!segments || segments.length === 0) {
		return "";
	}

	const paragraphs: string[] = [];

	for (const segment of segments) {
		if (isTextSegment(segment)) {
			const text = textSegmentToMarkdown(segment);
			if (text) {
				paragraphs.push(text);
			}
		}
		// Add handling for other segment types here if needed (images, etc.)
	}

	// Join paragraphs with double newlines
	let content = paragraphs.join("\n\n");

	// Append footnote definitions
	const footnoteDefs = footnotesToMarkdown(footnotes);
	if (footnoteDefs) {
		content += footnoteDefs;
	}

	return content;
}

/**
 * Convert a TextSegment to markdown
 */
function textSegmentToMarkdown(segment: TextSegment): string {
	if (!segment.runs || segment.runs.length === 0) {
		return "";
	}

	return segment.runs.map((run) => textRunToMarkdown(run)).join("");
}

/**
 * Convert a TextRun to markdown
 * Handles bold, italic, and footnote references
 */
function textRunToMarkdown(run: TextRun): string {
	let text = run.text || "";

	// Handle footnote reference
	if (run.footnoteId) {
		// Insert footnote reference at the end of the text
		text = `${text}[^${run.footnoteId}]`;
	}

	// Apply formatting
	if (run.isBold && run.isItalic) {
		text = `***${text}***`;
	} else if (run.isBold) {
		text = `**${text}**`;
	} else if (run.isItalic) {
		text = `*${text}*`;
	}

	return text;
}

/**
 * Convert series description (TextSegment[]) to markdown
 */
export function descriptionToMarkdown(segments: TextSegment[] | null): string {
	if (!segments || segments.length === 0) {
		return "";
	}

	return segments
		.map((segment) => textSegmentToMarkdown(segment))
		.filter(Boolean)
		.join("\n\n");
}
