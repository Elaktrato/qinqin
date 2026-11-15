// Mirrors the journal documents of the server (journal/docs.go).
import type { AiStatus } from '$lib/api/ai';

export interface JournalEntry {
	id: string;
	date: string;
	title: string;
	text: string;
	source: 'typed' | 'photo';
	createdAt: string;
	updatedAt: string;
}

export interface Annotation {
	id: string;
	quote: string;
	prefix: string;
	suffix: string;
	correction: string;
	explanation: string;
	category: string;
}

export interface DropCounts {
	notFound: number;
	wrongScript: number;
	noChange: number;
	overlap: number;
	empty: number;
	tooMany: number;
}

export interface Review {
	entryId: string;
	textHash: string;
	annotations: Annotation[];
	overall: { summary: string; strengths: string[]; focus: string[] };
	model: string;
	provider?: string;
	fallbackFrom?: string;
	dropped: DropCounts;
	createdAt: string;
}

export interface SuggestionItem {
	title: string;
	prompt: string;
	words: string[];
}

export interface Suggestions {
	items: SuggestionItem[];
	model: string;
	provider?: string;
	createdAt: string;
}

export interface JournalSettings {
	guidance: string;
	explanationLanguage: string;
}

export interface Capabilities {
	ai: AiStatus;
	ocr: { available: boolean; languageReady: boolean; language: string };
}
