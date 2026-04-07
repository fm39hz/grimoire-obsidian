/**
 * Footnote conversion utilities
 * Handles conversion between API FootnoteSegment format and markdown footnotes
 */

import type { FootnoteSegment, TextSegment, TextRun } from "../types";

/**
 * Result of parsing markdown footnotes
 */
export interface ParsedFootnotes {
	/** Content with footnote references (e.g., [^1]) */
	content: string;
	/** Map of footnote ID to its content */
	footnotes: Map<string, string>;
}

/**
 * Parse markdown content to extract footnote definitions
 * Returns the content without footnote definitions and a map of footnotes
 */
export function parseMarkdownFootnotes(content: string): ParsedFootnotes {
	const footnotes = new Map<string, string>();

	// Match footnote definitions: [^id]: content
	// Simpler regex that works without 's' flag
	const footnoteRegex = /^\[\^([^\]]+)\]:\s*(.+)$/gm;

	let match = footnoteRegex.exec(content);
	while (match !== null) {
		const id = match[1];
		const footnoteContent = match[2];
		if (id && footnoteContent) {
			footnotes.set(id, footnoteContent.trim());
		}
		match = footnoteRegex.exec(content);
	}

	// Remove footnote definitions from content
	const contentWithoutFootnotes = content
		.replace(/^\[\^[^\]]+\]:\s*.+$/gm, "")
		.replace(/\n{3,}/g, "\n\n") // Clean up extra newlines
		.trimEnd();

	return {
		content: contentWithoutFootnotes,
		footnotes,
	};
}

/**
 * Convert parsed footnotes back to FootnoteSegment array for API
 */
export function markdownFootnotesToSegments(footnotes: Map<string, string>): FootnoteSegment[] {
	const result: FootnoteSegment[] = [];

	for (const [id, content] of footnotes) {
		result.push({
			id,
			segments: parseFootnoteContentToSegments(content),
		});
	}

	return result;
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
 * Parse footnote content text into TextSegment array
 * Basic implementation - handles bold, italic
 */
function parseFootnoteContentToSegments(content: string): TextSegment[] {
	// For simplicity, treat the entire footnote as a single segment with runs
	const runs = parseTextToRuns(content);

	return [
		{
			id: generateUUID(),
			runs,
		},
	];
}

/**
 * Parse markdown text into TextRun array
 * Handles **bold**, *italic*, ***bold italic***
 */
export function parseTextToRuns(text: string): TextRun[] {
	const runs: TextRun[] = [];

	// Regex to match formatting patterns
	// Order matters: check bold+italic first, then bold, then italic
	const patterns = [
		{ regex: /\*\*\*(.+?)\*\*\*/g, bold: true, italic: true },
		{ regex: /\*\*(.+?)\*\*/g, bold: true, italic: false },
		{ regex: /\*(.+?)\*/g, bold: false, italic: true },
	];

	// Track positions of formatted text
	interface FormattedSpan {
		start: number;
		end: number;
		text: string;
		isBold: boolean;
		isItalic: boolean;
	}

	const spans: FormattedSpan[] = [];

	for (const pattern of patterns) {
		const regex = new RegExp(pattern.regex.source, "g");
		let match = regex.exec(text);
		while (match !== null) {
			// Check if this span overlaps with existing spans
			const start = match.index;
			const end = match.index + match[0].length;
			const overlaps = spans.some(
				(s) => (start >= s.start && start < s.end) || (end > s.start && end <= s.end)
			);

			const capturedText = match[1];
			if (!overlaps && capturedText) {
				spans.push({
					start,
					end,
					text: capturedText,
					isBold: pattern.bold,
					isItalic: pattern.italic,
				});
			}
			match = regex.exec(text);
		}
	}

	// Sort spans by position
	spans.sort((a, b) => a.start - b.start);

	// Build runs from spans and gaps
	let pos = 0;
	for (const span of spans) {
		// Add plain text before this span
		if (span.start > pos) {
			const plainText = text.slice(pos, span.start);
			if (plainText) {
				runs.push({ text: plainText, isBold: false, isItalic: false });
			}
		}

		// Add formatted span
		runs.push({
			text: span.text,
			isBold: span.isBold,
			isItalic: span.isItalic,
		});

		pos = span.end;
	}

	// Add remaining plain text
	if (pos < text.length) {
		const remaining = text.slice(pos);
		if (remaining) {
			runs.push({ text: remaining, isBold: false, isItalic: false });
		}
	}

	// If no runs were created, add the whole text as plain
	if (runs.length === 0 && text) {
		runs.push({ text, isBold: false, isItalic: false });
	}

	return runs;
}
