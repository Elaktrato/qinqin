import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Badges from './Badges.svelte';

const badge = (schemeName: string) => ({ schemeId: 1, schemeName, levelName: 'N5', derived: false });

describe('Badges', () => {
	it('shows "(approx.)" and gives screen readers "(approximate)"', () => {
		const { body } = render(Badges, { props: { badges: [badge('JLPT kanji (approximate)')] } });
		const text = body.replace(/<!--[^>]*-->/g, '');
		expect(text).toContain('JLPT kanji <span aria-hidden="true">(approx.)</span>');
		expect(text).toMatch(/<span class="visually-hidden[^"]*">\(approximate\)<\/span>/);
	});

	it('renders any other scheme name plainly', () => {
		const { body } = render(Badges, { props: { badges: [badge('JLPT (vocabulary)')] } });
		expect(body).toContain('JLPT vocabulary');
		expect(body).not.toContain('visually-hidden');
	});
});
