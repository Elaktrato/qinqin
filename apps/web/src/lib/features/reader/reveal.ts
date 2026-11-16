// Revealing concealed readings (known words in smart mode). A reveal only
// toggles a class: the reading is always laid out, so nothing moves.
//   - hover: CSS (ruby:hover)
//   - tap: a pointerup within TAP_SLOP_PX of its pointerdown reveals that
//     word for REVEAL_MS; the listeners are passive and never stop an
//     event, so the lookup popup opens as before
//   - keyboard: `R` (outside fields) or the panel's button shows all
import type { KeyLike } from './bookmarkList.svelte';

export const REVEAL_MS = 4000;
export const TAP_SLOP_PX = 6;

/** tapTarget: the <ruby> whose reading is concealed, from any node inside it. */
export function tapTarget(node: EventTarget | null): HTMLElement | null {
	const el = node instanceof Element ? node.closest('ruby') : null;
	if (!el) return null;
	for (const child of el.children) if (child.tagName === 'RT' && child.classList.contains('concealed')) return el as HTMLElement;
	return null;
}

/** revealKey: a plain `R` while nothing else owns the keys. */
export function revealKey(e: KeyLike, ctx: { busy: boolean }): boolean {
	if (e.key !== 'r' && e.key !== 'R') return false;
	if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
	if (e.repeat || e.isComposing || e.defaultPrevented) return false;
	return !ctx.busy;
}

export interface Reveal {
	/** Reveals one word for REVEAL_MS; tapping again restarts the timer. */
	tap(el: HTMLElement): void;
	toggleAll(): void;
	readonly isAllShown: boolean;
	/** Hides everything and cancels the timers (chapter change). */
	reset(): void;
	/** Wires the tap listeners on a container; returns the detach function. */
	attach(container: HTMLElement): () => void;
}

export function createReveal(opts: { onAll?: (shown: boolean) => void } = {}): Reveal {
	const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
	let all = false;

	const hide = (el: HTMLElement): void => {
		clearTimeout(timers.get(el));
		timers.delete(el);
		el.classList.remove('revealed');
	};

	const setAll = (shown: boolean): void => {
		if (all === shown) return;
		all = shown;
		opts.onAll?.(shown);
	};

	const reveal: Reveal = {
		tap(el) {
			clearTimeout(timers.get(el));
			el.classList.add('revealed');
			timers.set(el, setTimeout(() => hide(el), REVEAL_MS));
		},
		toggleAll() {
			setAll(!all);
		},
		get isAllShown() {
			return all;
		},
		reset() {
			for (const el of [...timers.keys()]) hide(el);
			setAll(false);
		},
		attach(container) {
			let down: { id: number; x: number; y: number } | null = null;
			const onDown = (e: PointerEvent): void => {
				down = { id: e.pointerId, x: e.clientX, y: e.clientY };
			};
			const onUp = (e: PointerEvent): void => {
				const start = down;
				down = null;
				if (!start || start.id !== e.pointerId) return;
				if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) return;
				const el = tapTarget(e.target);
				if (el) reveal.tap(el);
			};
			const options = { passive: true };
			container.addEventListener('pointerdown', onDown, options);
			container.addEventListener('pointerup', onUp, options);
			return () => {
				container.removeEventListener('pointerdown', onDown);
				container.removeEventListener('pointerup', onUp);
			};
		}
	};
	return reveal;
}
