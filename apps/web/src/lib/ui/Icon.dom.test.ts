import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Icon from './Icon.svelte';

function svg(container: HTMLElement): SVGSVGElement {
	return container.querySelector('svg')!;
}

describe('Icon', () => {
	it('draws a 24-grid line icon at stroke 1.5 in currentColor', () => {
		const { container } = render(Icon, { name: 'search' });
		const el = svg(container);
		expect(el.getAttribute('viewBox')).toBe('0 0 24 24');
		expect(el.getAttribute('fill')).toBe('none');
		expect(el.getAttribute('stroke')).toBe('currentColor');
		expect(el.getAttribute('stroke-width')).toBe('1.5');
		expect(el.getAttribute('stroke-linecap')).toBe('round');
		expect(el.querySelectorAll('circle, path').length).toBeGreaterThan(0);
		for (const child of el.children) expect(child.namespaceURI).toBe('http://www.w3.org/2000/svg');
	});

	it('is decorative by default', () => {
		const el = svg(render(Icon, { name: 'close' }).container);
		expect(el.getAttribute('aria-hidden')).toBe('true');
		expect(el.getAttribute('focusable')).toBe('false');
		expect(el.getAttribute('role')).toBeNull();
	});

	it('is an image with a name when given a label', () => {
		const el = svg(render(Icon, { name: 'alert', label: 'Error' }).container);
		expect(el.getAttribute('role')).toBe('img');
		expect(el.getAttribute('aria-label')).toBe('Error');
		expect(el.getAttribute('aria-hidden')).toBeNull();
	});

	it('sizes from the icon tokens or a pixel number', () => {
		expect(svg(render(Icon, { name: 'home' }).container).getAttribute('class')).toContain('size-m');
		expect(svg(render(Icon, { name: 'home', size: 's' }).container).getAttribute('class')).toContain('size-s');
		const px = svg(render(Icon, { name: 'home', size: 18 }).container);
		expect(px.getAttribute('width')).toBe('18');
		expect(px.getAttribute('height')).toBe('18');
	});
});
