// The things on screen that the Android back button (and any "close the top thing" request) must close first,
// innermost first: modal dialogs, sheets, drawers and open menus register here while they are open (modal.ts,
// Menu.svelte). A plain stack of close functions; it knows nothing of the shell (lib/native consults it).
// Module-level on purpose: it is the view of one document's overlays, not per-user state (record 0009), and it
// holds no data.

const stack: Array<() => void> = [];

/** registerDismissable adds `close` on top of the stack and returns the function that removes it again. */
export function registerDismissable(close: () => void): () => void {
	stack.push(close);
	return () => {
		const i = stack.lastIndexOf(close);
		if (i >= 0) stack.splice(i, 1);
	};
}

/** hasDismissable: whether anything is open. */
export function hasDismissable(): boolean {
	return stack.length > 0;
}

/**
 * dismissTop asks the innermost registered thing to close, and says whether there was one. The thing may
 * decline (a dialog busy with an action); the request still counts as handled, so the press is not also
 * turned into a navigation.
 */
export function dismissTop(): boolean {
	const top = stack[stack.length - 1];
	if (top === undefined) return false;
	top();
	return true;
}
