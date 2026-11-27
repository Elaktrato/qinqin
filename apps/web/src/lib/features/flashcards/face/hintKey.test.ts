import { describe, expect, it } from 'vitest';

import { isHintKey } from './hintKey';

const base = { key: 'h', code: 'KeyH', altKey: false, ctrlKey: false, metaKey: false, repeat: false, composing: false };

describe('isHintKey', () => {
	it('is the plain H key outside a text field', () => {
		expect(isHintKey({ ...base }, false)).toBe(true);
		expect(isHintKey({ ...base, key: 'H' }, false)).toBe(true);
	});

	it('leaves H to a text field, where Alt+H still asks for the hint', () => {
		expect(isHintKey({ ...base }, true)).toBe(false);
		expect(isHintKey({ ...base, altKey: true, key: '˙' }, true)).toBe(true);
	});

	it('ignores other keys, Ctrl and Meta chords, repeats and IME composition', () => {
		expect(isHintKey({ ...base, key: 'j', code: 'KeyJ' }, false)).toBe(false);
		expect(isHintKey({ ...base, ctrlKey: true }, false)).toBe(false);
		expect(isHintKey({ ...base, metaKey: true }, false)).toBe(false);
		expect(isHintKey({ ...base, repeat: true }, false)).toBe(false);
		expect(isHintKey({ ...base, composing: true }, false)).toBe(false);
	});
});
