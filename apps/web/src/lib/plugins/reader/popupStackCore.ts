import type { LookupResult } from '$lib/api/types';

/** Deepest allowed popup nesting. */
export const MAX_DEPTH = 4;

export interface PopupFrame {
	id: number;
	depth: number;
	anchor: { x: number; y: number; w: number; h: number };
	text: string;
	offset: number;
	results: LookupResult[] | null;
	error?: string;
}

/**
 * Pure, DOM-free logic of the nested lookup popups. Every function takes an
 * immutable frames array and returns a new one; when nothing changes the
 * SAME array is returned, so callers can detect no-ops by identity.
 */

/**
 * Opens a frame under `parentId` (dropping every frame above the parent) or,
 * without a parent, replaces the whole stack with a depth-1 frame. Returns
 * null (nothing to apply) when the parent is given but not open, or when the
 * new frame would exceed MAX_DEPTH. `nextId` is the caller's id counter; the
 * result carries the advanced counter. The input frame is copied, not aliased.
 */
export function openFrame(
	frames: PopupFrame[],
	nextId: number,
	frame: Omit<PopupFrame, 'id' | 'depth'>,
	parentId?: number
): { frames: PopupFrame[]; id: number; nextId: number } | null {
	let kept: PopupFrame[] = [];
	let depth = 1;
	if (parentId !== undefined) {
		const idx = frames.findIndex((f) => f.id === parentId);
		if (idx < 0) return null;
		kept = frames.slice(0, idx + 1);
		depth = frames[idx].depth + 1;
	}
	if (depth > MAX_DEPTH) return null;
	const opened: PopupFrame = { ...frame, anchor: { ...frame.anchor }, id: nextId, depth };
	return { frames: [...kept, opened], id: nextId, nextId: nextId + 1 };
}

export function closeTop(frames: PopupFrame[]): PopupFrame[] {
	return frames.length ? frames.slice(0, -1) : frames;
}

export function closeAll(): PopupFrame[] {
	return [];
}

/** Removes every frame deeper than the frame `id`; unknown id is a no-op. */
export function closeAbove(frames: PopupFrame[], id: number): PopupFrame[] {
	const idx = frames.findIndex((f) => f.id === id);
	return idx < 0 || idx === frames.length - 1 ? frames : frames.slice(0, idx + 1);
}

export type FramePatch = Partial<Pick<PopupFrame, 'results' | 'error' | 'anchor'>>;

/** Patches results/error/anchor of an open frame; a closed frame is a no-op. */
export function updateFrame(frames: PopupFrame[], id: number, patch: FramePatch): PopupFrame[] {
	if (!frames.some((f) => f.id === id)) return frames;
	const copy = patch.anchor ? { ...patch, anchor: { ...patch.anchor } } : patch;
	return frames.map((f) => (f.id === id ? { ...f, ...copy } : f));
}
