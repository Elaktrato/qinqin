// The study key for a hint (#215): H, or Alt+H inside a text field (where H is a letter). Matched by the
// physical key (`code`) so Alt+H on a Mac, which types ˙, still works.

export interface HintKeyEvent {
	key: string;
	code: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	repeat: boolean;
	/** An IME is composing (its keys are not shortcuts). */
	composing: boolean;
}

/** inTextField: the key was typed into a text field or a card's own input (a pad, tiles). */
export function isHintKey(e: HintKeyEvent, inTextField: boolean): boolean {
	if (e.repeat || e.composing || e.ctrlKey || e.metaKey) return false;
	const isH = e.code === 'KeyH' || e.key.toLowerCase() === 'h';
	if (!isH) return false;
	return e.altKey || !inTextField;
}
