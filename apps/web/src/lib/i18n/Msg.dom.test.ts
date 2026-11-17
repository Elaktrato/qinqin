import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Msg from './Msg.svelte';
import { installCatalogue, resetCatalogue, type MessageKey } from './index';

afterEach(() => {
	resetCatalogue();
	vi.restoreAllMocks();
});

const k = (s: string) => s as MessageKey;

describe('Msg', () => {
	it('renders plain text', () => {
		const { container } = render(Msg, { key: 'app.name' });
		expect(container.textContent).toBe('qinqin');
	});

	it('renders a <link> tag through the snippet of the same name, arguments escaped', () => {
		installCatalogue('xx', { 'test.link': 'Read the <link>{what}</link> first' });
		const link = createRawSnippet((text: () => string) => ({
			render: () => `<a href="/privacy">${text().replace(/</g, '&lt;')}</a>`
		}));
		const { container } = render(Msg, { key: k('test.link'), args: { what: 'privacy <notes>' }, link });
		const a = container.querySelector('a')!;
		expect(a.getAttribute('href')).toBe('/privacy');
		expect(a.textContent).toBe('privacy <notes>');
		expect(container.textContent).toBe('Read the privacy <notes> first');
	});

	it('renders a tag without a snippet as its text and warns', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		installCatalogue('xx', { 'test.bold': 'A <strong>bold</strong> word' });
		const { container } = render(Msg, { key: k('test.bold') });
		expect(container.textContent).toBe('A bold word');
		expect(container.querySelector('strong')).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('strong'));
	});
});
