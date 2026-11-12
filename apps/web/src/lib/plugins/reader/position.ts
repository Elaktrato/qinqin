// A book's reading position is stored server-side as "<chapter>:<paragraph>".

export interface Position {
	chapter: number;
	paragraph: number;
}

export function formatPosition(chapter: number, paragraph: number): string {
	return `${chapter}:${paragraph}`;
}

function parseIndex(part: string): number | null {
	if (!/^\d+$/.test(part)) return null;
	const n = Number(part);
	return Number.isSafeInteger(n) ? n : null;
}

/** parsePosition reads a stored position; anything malformed is null. */
export function parsePosition(s: string): Position | null {
	const parts = s.split(':');
	if (parts.length !== 2) return null;
	const chapter = parseIndex(parts[0]);
	const paragraph = parseIndex(parts[1]);
	if (chapter === null || paragraph === null) return null;
	return { chapter, paragraph };
}
