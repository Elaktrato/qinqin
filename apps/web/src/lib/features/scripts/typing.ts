// Typing practice: the learner types the glyph with the keyboard of the device (an input method for kana and
// Hangul, the ЙЦУКЕН layout for Russian). The check is on the text, not on the keys.

/** normalise: compatibility forms folded (a jamo typed as U+3131 equals the conjoining U+1100), case folded, spaces dropped. */
export function normaliseTyped(text: string): string {
	return text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
}

/** checkTyped: whether the typed text is one of the accepted ones. */
export function checkTyped(input: string, accepts: readonly string[]): boolean {
	const typed = normaliseTyped(input);
	return typed !== '' && accepts.some((a) => normaliseTyped(a) === typed);
}

/** A typing hint: the key text of an item as a sequence of keys ("H, K" is two presses). */
export function keySteps(key: string | undefined): string[] {
	if (key === undefined) return [];
	return key.split(',').map((s) => s.trim()).filter((s) => s !== '');
}
