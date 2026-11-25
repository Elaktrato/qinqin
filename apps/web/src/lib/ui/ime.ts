// IME guard: one answer to "is this key press part of an IME composition?"
// (Japanese, Chinese, Korean input). Enter confirms a candidate and Escape
// cancels it, neither may trigger the app's own action.
//
// Three signals, because no single one is reliable:
//  - `event.isComposing`: Chrome/Firefox; false on the confirming Enter in Safari.
//  - `keyCode === 229`: what Android Gboard/Samsung and Safari send for IME keys,
//    often with isComposing false.
//  - the compositionstart/compositionend window tracked here; Safari fires
//    compositionend BEFORE the final keydown, so the flag also stays set for a
//    few milliseconds after the end.

const AFTER_END_MS = 50;

let composing = false;
let endedAt = -Infinity;
let installed = false;

function install(): void {
	if (installed || typeof document === 'undefined') return;
	installed = true;
	document.addEventListener('compositionstart', () => (composing = true), true);
	document.addEventListener(
		'compositionend',
		() => {
			composing = false;
			endedAt = Date.now();
		},
		true
	);
}
install();

/** True while a composition is open or ended a moment ago. */
export function imeComposing(): boolean {
	install();
	return composing || Date.now() - endedAt < AFTER_END_MS;
}

/** True when the key event belongs to an IME composition and must not trigger an action. */
export function isImeKey(e: { isComposing?: boolean; keyCode?: number }): boolean {
	return e.isComposing === true || e.keyCode === 229 || imeComposing();
}
