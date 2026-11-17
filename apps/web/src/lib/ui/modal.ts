// Shared by Dialog and Sheet: a native <dialog> opened modally (the browser
// makes the page inert, traps focus and turns Escape into `cancel`), with a
// script fallback where showModal is missing (jsdom, old WebViews): the
// `open` attribute, Tab wrapping inside, and the caller's Escape handling.
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
 * modal is a Svelte action for a <dialog> rendered while open: it opens the
 * dialog modally, focuses `initialFocus` (a selector inside it) or the first
 * focusable element, and on removal gives focus back.
 */
export function modal(node: HTMLDialogElement, initialFocus?: string): { destroy(): void } {
	const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	if (typeof node.showModal === 'function') {
		try {
			node.showModal();
		} catch {
			node.setAttribute('open', '');
		}
	} else node.setAttribute('open', '');
	const target = (initialFocus ? node.querySelector<HTMLElement>(initialFocus) : null) ?? focusables(node)[0] ?? node;
	// Now (the dialog is in the document when the action runs), and once more
	// after the browser's own showModal focusing step, unless focus has moved on.
	target.focus();
	queueMicrotask(() => {
		if (!node.contains(document.activeElement) || document.activeElement === node) target.focus();
	});
	return {
		destroy() {
			if (typeof node.close === 'function' && node.open) node.close();
			if (before && before.isConnected) queueMicrotask(() => before.focus());
		}
	};
}
