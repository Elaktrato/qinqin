import { describe, expect, it } from 'vitest';
import source from './IdeasPanel.svelte?raw';

describe('journal ideas panel', () => {
	it('uses the base Button for Get ideas and Start an entry, not raw buttons', () => {
		expect(source).not.toMatch(/<button\b/);
		expect(source.match(/<Button\b/g)?.length).toBe(2);
	});
});
