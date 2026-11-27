/**
 * The writing pad's size (#285): square, as wide as its container allows, but never so tall that what must
 * stay on screen below it (the feedback line, the pad's own buttons) is pushed under the docked actions or off
 * the screen. Both pads (the flashcards' writing card and the scripts trainer's Write mode) use it. The matcher
 * works in pad units, so the size changes nothing about how strokes are judged.
 */

export interface PadLimits {
	/** Smallest side in CSS px: below it a character cannot be drawn, and the page scrolls instead. */
	min: number;
	/** Largest side in CSS px. */
	max: number;
}

/** 10rem to 22.5rem on a touch screen, 10rem to 17.5rem with a mouse or pen (about today's 12.5rem, a little larger). */
export function padLimits(rem: number, coarse: boolean): PadLimits {
	return { min: 10 * rem, max: (coarse ? 22.5 : 17.5) * rem };
}

export interface PadMeasure {
	/** The width the container gives the pad. */
	width: number;
	/** The pad's side now. */
	side: number;
	/**
	 * How far the last thing that must stay visible ends above the bottom of the free space (the screen minus the
	 * docked actions), with the page at its top: positive is room to grow, negative is how much to give up.
	 */
	slack: number;
}

/**
 * padSide is the pad's side for a measurement: `side + slack` within the limits, and never wider than its
 * container. Nothing below the pad depends on its size, so one measurement reaches the fixed point.
 */
export function padSide(m: PadMeasure, limits: PadLimits): number {
	if (!Number.isFinite(m.width) || !Number.isFinite(m.slack) || !Number.isFinite(m.side)) return m.side;
	const byHeight = Math.min(limits.max, Math.max(limits.min, m.side + m.slack));
	return Math.max(0, Math.floor(Math.min(m.width, byHeight)));
}

export interface FitPadOptions {
	/** The last element that must stay on screen below the pad (the feedback line, the pad's buttons). */
	end: () => Element | null | undefined;
	/** A sticky bar at the bottom of the screen whose height is not free space (the card's docked actions). */
	dock?: () => Element | null | undefined;
}

/** The nearest ancestor that scrolls vertically, or null for the page itself. */
function scroller(node: Element): HTMLElement | null {
	for (let cur = node.parentElement; cur && cur !== document.body && cur !== document.documentElement; cur = cur.parentElement) {
		const y = getComputedStyle(cur).overflowY;
		if (y === 'auto' || y === 'scroll') return cur;
	}
	return null;
}

function matches(query: string): boolean {
	try {
		return window.matchMedia(query).matches;
	} catch {
		return false;
	}
}

/** The slack of one layout, in the scroll container's content coordinates (independent of where it is scrolled). */
function measureSlack(end: Element, dock: Element | null | undefined, box: HTMLElement | null): number {
	const top = box ? box.getBoundingClientRect().top + box.clientTop : 0;
	const scrolled = box ? box.scrollTop : window.scrollY;
	const visible = box ? box.clientHeight : window.innerHeight;
	const endBottom = end.getBoundingClientRect().bottom - top + scrolled;
	const reserved = dock ? dock.getBoundingClientRect().height : 0;
	return visible - reserved - endBottom;
}

/**
 * fitPad (a Svelte action on the pad's wrapper) sets the wrapper's width to the pad's side and keeps it there when
 * the container or the window changes size (rotation, a resized window, the browser bar). The pad inside is
 * `width: 100%` and square; its canvas follows through its own ResizeObserver.
 */
export function fitPad(node: HTMLElement, options: FitPadOptions): { update: (o: FitPadOptions) => void; destroy: () => void } {
	let opts = options;
	let frame = 0;
	const fit = () => {
		frame = 0;
		const parent = node.parentElement;
		const end = opts.end();
		if (!parent || !end) return;
		const style = getComputedStyle(parent);
		const width = parent.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
		const side = node.getBoundingClientRect().width;
		const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		const next = padSide({ width, side, slack: measureSlack(end, opts.dock?.(), scroller(node)) }, padLimits(rem, matches('(pointer: coarse)')));
		if (Math.abs(next - side) >= 1) node.style.width = `${next}px`;
	};
	const schedule = () => {
		if (frame === 0) frame = requestAnimationFrame(fit);
	};
	fit();
	const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
	if (node.parentElement) observer?.observe(node.parentElement);
	window.addEventListener('resize', schedule);
	return {
		update(o: FitPadOptions) {
			opts = o;
			schedule();
		},
		destroy() {
			observer?.disconnect();
			window.removeEventListener('resize', schedule);
			if (frame !== 0) cancelAnimationFrame(frame);
		}
	};
}
