// Is the phone's on-screen keyboard open? (#188) The bottom bar steps aside
// while it is, so it never rides up over the field being typed in. Two
// signals, either one is enough:
//
// - the visual viewport is shrunk well below the layout viewport (the
//   keyboard covers the bottom; pinch zoom is told apart by its scale), and
// - a text field has focus on a touch screen (where the browser resizes the
//   layout viewport instead, the first signal never fires; a hardware
//   keyboard on a touch screen is the cost: the bar hides while typing).

/** How much of the window the keyboard must cover, in CSS px (more than any browser toolbar). */
export const KEYBOARD_MIN_PX = 150;

const NO_KEYBOARD_INPUTS = new Set([
	'button',
	'checkbox',
	'color',
	'file',
	'hidden',
	'image',
	'radio',
	'range',
	'reset',
	'submit'
]);

/** viewportShrunk: true when the visual viewport is shrunk by a keyboard, not by zoom. */
export function viewportShrunk(innerHeight: number, viewport: { height: number; scale: number } | null): boolean {
	if (!viewport || !(innerHeight > 0)) return false;
	return innerHeight - viewport.height * viewport.scale > KEYBOARD_MIN_PX;
}

/** typesText: an element that brings up the on-screen keyboard when focused. */
export function typesText(el: Element | null): boolean {
	if (!(el instanceof HTMLElement)) return false;
	if (el.isContentEditable) return true;
	if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
	if (el instanceof HTMLInputElement) return !NO_KEYBOARD_INPUTS.has(el.type) && !el.readOnly && !el.disabled;
	return false;
}

/**
 * watchKeyboard calls `change` with true/false whenever the keyboard opens
 * or closes (and once at the start); returns the unsubscribe.
 */
export function watchKeyboard(change: (open: boolean) => void, win: Window = window): () => void {
	const coarse = typeof win.matchMedia === 'function' ? win.matchMedia('(pointer: coarse)') : null;
	let last: boolean | null = null;
	const check = (): void => {
		const vv = win.visualViewport;
		const shrunk = viewportShrunk(win.innerHeight, vv ? { height: vv.height, scale: vv.scale } : null);
		const typing = coarse?.matches === true && typesText(win.document.activeElement);
		const open = shrunk || typing;
		if (open !== last) {
			last = open;
			change(open);
		}
	};
	// focusout fires before the next element has focus: check after it settles.
	const later = (): void => void setTimeout(check);
	win.visualViewport?.addEventListener('resize', check);
	win.document.addEventListener('focusin', check);
	win.document.addEventListener('focusout', later);
	check();
	return () => {
		win.visualViewport?.removeEventListener('resize', check);
		win.document.removeEventListener('focusin', check);
		win.document.removeEventListener('focusout', later);
	};
}
