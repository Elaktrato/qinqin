/** choiceForKey maps the keys 1-5 to a choice index; anything else (or out of range) is null. */
export function choiceForKey(key: string, count: number): number | null {
	if (!/^[1-5]$/.test(key)) return null;
	const index = Number(key) - 1;
	return index < count ? index : null;
}

interface KeyTarget {
	tagName: string;
	type?: string;
	isContentEditable?: boolean;
}

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

function takesText(el: KeyTarget | null): boolean {
	if (!el) return false;
	if (el.isContentEditable) return true;
	const tag = el.tagName.toUpperCase();
	if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
	return tag === 'INPUT' && !NON_TEXT_INPUTS.has((el.type ?? '').toLowerCase());
}

/**
 * choiceForKeyEvent is the choice a key press picks: none for modified
 * keys, IME composition, or keys typed into a field.
 */
export function choiceForKeyEvent(
	e: {
		key: string;
		ctrlKey: boolean;
		metaKey: boolean;
		altKey: boolean;
		isComposing?: boolean;
		target: KeyTarget | null;
	},
	count: number
): number | null {
	if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
	if (takesText(e.target)) return null;
	return choiceForKey(e.key, count);
}
