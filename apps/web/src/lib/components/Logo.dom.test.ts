import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import source from '$lib/assets/qinqin-logo.svg?raw';
import Logo from './Logo.svelte';

describe('Logo', () => {
	it('draws the logo outline in the current text colour and is decorative', () => {
		const { container } = render(Logo, { size: 32 });
		const svg = container.querySelector('svg')!;
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('fill')).toBe('currentColor');
		expect(svg.getAttribute('width')).toBe('32');
		const d = /<path d="([^"]+)"/.exec(source)![1];
		expect(svg.querySelector('path')!.getAttribute('d')).toBe(d);
	});
});
