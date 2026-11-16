import {
	closeAbove,
	closeAll,
	closeTop,
	openFrame,
	updateFrame,
	type FramePatch,
	type PopupFrame
} from './popupStackCore';

export { MAX_DEPTH, type PopupFrame } from './popupStackCore';

/**
 * Reactive popup stack: a thin wrapper over the pure functions in
 * popupStackCore. `frames` is `$state.raw` and is reassigned (never mutated)
 * on every change, so reads of `stack.frames` in components and effects are
 * reactive.
 */
export class PopupStack {
	frames = $state.raw<PopupFrame[]>([]);
	private nextId = 1;

	/** Returns the new frame's id, or null (nothing changed) at MAX_DEPTH or for an unknown parent. */
	open(frame: Omit<PopupFrame, 'id' | 'depth'>, parentId?: number): number | null {
		const r = openFrame(this.frames, this.nextId, frame, parentId);
		if (!r) return null;
		this.frames = r.frames;
		this.nextId = r.nextId;
		return r.id;
	}

	closeTop(): void {
		this.frames = closeTop(this.frames);
	}

	closeAll(): void {
		this.frames = closeAll();
	}

	closeAbove(id: number): void {
		this.frames = closeAbove(this.frames, id);
	}

	/** No-op for a closed frame, so stale responses never touch it. */
	update(id: number, patch: FramePatch): void {
		this.frames = updateFrame(this.frames, id, patch);
	}
}
