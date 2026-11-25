// IME guard: one answer to "is this key press part of an IME composition?"
// (Japanese, Chinese, Korean input). Enter confirms a candidate and Escape
// cancels it, neither may trigger the app's own action.
//
// Three signals, because no single one is reliable:
//  - `event.isComposing`: Chrome/Firefox; false on the confirming Enter in Safari.
//  - `keyCode === 229`: what Android Gboard/Samsung and Safari send for IME keys,
//    often with isComposing false. Safari fires compositionend BEFORE the final
//    keydown of a composition, but that keydown still carries keyCode 229, so
//    no time window after compositionend is needed (and one would swallow the
//    genuine Enter that Gboard sends within milliseconds of committing a Latin
//    word: that Enter has keyCode 13).
//  - the compositionstart/compositionend flag tracked here, for keyboards that
//    send keys during a composition with isComposing false and a real keyCode.
//
// The flag is dropped when the composing element loses focus or is removed:
// a detached input never gets compositionend, and a stuck flag would kill
// every Enter/Escape handler.

let composing = false;
let target: EventTarget | null = null;
let installed = false;

function reset(): void {
	composing = false;
	target = null;
}

function install(): void {
	if (installed || typeof document === 'undefined') return;
	installed = true;
	document.addEventListener(
		'compositionstart',
		(e) => {
			composing = true;
			target = e.target;
		},
		true
	);
	document.addEventListener('compositionend', reset, true);
	document.addEventListener('focusout', reset, true);
	window.addEventListener('blur', reset);
	// Safety net for implicit form submission (Enter in a single-line input):
	// browsers normally block it during composition, but Android Chrome with some
	// keyboards sends the confirming Enter with isComposing false. Cancelling the
	// default of an IME Enter keeps every <form onsubmit> from firing on it.
	document.addEventListener(
		'keydown',
		(e) => {
			if (e.key === 'Enter' && isImeKey(e) && e.target instanceof HTMLInputElement) e.preventDefault();
		},
		true
	);
}
install();

/** True while a composition is open in the element that still has focus. */
export function imeComposing(): boolean {
	install();
	if (composing && target instanceof Element && (!target.isConnected || document.activeElement !== target)) reset();
	return composing;
}

/** True when the key event belongs to an IME composition and must not trigger an action. */
export function isImeKey(e: { isComposing?: boolean; keyCode?: number }): boolean {
	return e.isComposing === true || e.keyCode === 229 || imeComposing();
}
