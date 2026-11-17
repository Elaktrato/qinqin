// Shared by Dialog and Sheet: a native <dialog> opened modally (the browser
// makes the page inert, traps focus and turns Escape into `cancel`), with a
// script fallback where showModal is missing (jsdom, old WebViews): the
// `open` attribute, the rest of the page made `inert`, Tab wrapping inside,
// and the caller's Escape handling.
// Focus moves in on open and returns to where it was on close.

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** focusables lists the elements of `root` that Tab reaches, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]'));
}

/** wrapTab keeps Tab and Shift+Tab inside `root` (the fallback trap; harmless with showModal). */
export function wrapTab(e: KeyboardEvent, root: HTMLElement): void {
	if (e.key !== 'Tab') return;
	const list = focusables(root);
	if (list.length === 0) {
		e.preventDefault();
		return;
	}
	const first = list[0];
	const last = list[list.length - 1];
	const active = document.activeElement;
	if (e.shiftKey && (active === first || !root.contains(active))) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && (active === last || !root.contains(active))) {
		e.preventDefault();
		first.focus();
	}
}

/**
 * inertAround makes everything outside `node` inert (each sibling of `node`
 * and of its ancestors up to <body>) and returns the undo, which clears only
 * what it set: what was inert before stays inert.
 */
export function inertAround(node: HTMLElement): () => void {
	const set: Element[] = [];
	for (let el: HTMLElement | null = node; el && el !== document.body; el = el.parentElement) {
		for (const sib of el.parentElement?.children ?? []) {
			if (sib === el || sib.hasAttribute('inert') || sib.tagName === 'SCRIPT') continue;
			sib.setAttribute('inert', '');
			set.push(sib);
		}
	}
	return () => {
		for (const el of set) el.removeAttribute('inert');
	};
}

/**
 * modal is a Svelte action for a <dialog> rendered while open: it opens the
 * dialog modally, focuses `initialFocus` (a selector inside it) or the first
 * focusable element, and on removal gives focus back.
 */
export function modal(node: HTMLDialogElement, initialFocus?: string): { destroy(): void } {
	const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	let undoInert: (() => void) | null = null;
	const fallback = (): void => {
		node.setAttribute('open', '');
		undoInert = inertAround(node);
	};
	if (typeof node.showModal === 'function') {
		try {
			node.showModal();
		} catch {
			fallback();
		}
	} else fallback();
	const target = (initialFocus ? node.querySelector<HTMLElement>(initialFocus) : null) ?? focusables(node)[0] ?? node;
	// Now (the dialog is in the document when the action runs), and once more
	// after the browser's own showModal focusing step, unless focus has moved on.
	target.focus();
	queueMicrotask(() => {
		if (!node.contains(document.activeElement) || document.activeElement === node) target.focus();
	});
	return {
		destroy() {
			undoInert?.();
			if (typeof node.close === 'function' && node.open) node.close();
			if (before && before.isConnected) queueMicrotask(() => before.focus());
		}
	};
}
