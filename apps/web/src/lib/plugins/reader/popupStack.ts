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
 * PopupStack is the DOM-free core of the nested lookup popups. It is a plain
 * class: `frames` is never mutated in place, every change assigns a new
 * array (and new frame objects on update). A component can therefore hold an
 * instance in `$state(new PopupStack())` and read `stack.frames` reactively.
 */
export class PopupStack {
	frames: PopupFrame[] = [];
	private nextId = 1;

	/**
	 * Opens a frame under `parentId` (closing every frame above the parent
	 * first) or, without a parent, replaces the whole stack with a depth-1
	 * frame. Returns the new id, or null at MAX_DEPTH (nothing changes).
	 */
	open(frame: Omit<PopupFrame, 'id' | 'depth'>, parentId?: number): number | null {
		let kept: PopupFrame[] = [];
		let depth = 1;
		if (parentId !== undefined) {
			const idx = this.frames.findIndex((f) => f.id === parentId);
			if (idx >= 0) {
				kept = this.frames.slice(0, idx + 1);
				depth = this.frames[idx].depth + 1;
			}
		}
		if (depth > MAX_DEPTH) return null;
		const id = this.nextId++;
		this.frames = [...kept, { ...frame, id, depth }];
		return id;
	}

	closeTop(): void {
		if (this.frames.length) this.frames = this.frames.slice(0, -1);
	}

	closeAll(): void {
		if (this.frames.length) this.frames = [];
	}

	/** Removes every frame deeper than the frame `id`. */
	closeAbove(id: number): void {
		const idx = this.frames.findIndex((f) => f.id === id);
		if (idx >= 0 && idx < this.frames.length - 1) this.frames = this.frames.slice(0, idx + 1);
	}

	/** Sets results/error on an open frame; a no-op for a closed one. */
	update(id: number, patch: Partial<Pick<PopupFrame, 'results' | 'error'>>): void {
		if (!this.frames.some((f) => f.id === id)) return;
		this.frames = this.frames.map((f) => (f.id === id ? { ...f, ...patch } : f));
	}
}
