import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WidgetCard from './WidgetCard.svelte';

afterEach(cleanup);

const source = readFileSync(resolve(__dirname, 'WidgetCard.svelte'), 'utf8');
const style = source.slice(source.indexOf('<style'));
/** The declarations of one rule of the card's style. */
function rule(selector: string): string {
	const m = new RegExp(`(^|\\n)\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(style);
	return m?.[2] ?? '';
}

describe('WidgetCard (design §5: a box needs a reason)', () => {
	it('the card has no border, fill or shadow', () => {
		const card = rule('.widget-card');
		expect(card).not.toBe('');
		expect(card).not.toMatch(/(^|\s)border\s*:/);
		expect(card).not.toMatch(/background/);
		expect(card).not.toMatch(/box-shadow/);
	});

	it('the heading is a small sentence-case section heading', () => {
		const h2 = rule('h2');
		expect(h2).toMatch(/font-size:\s*var\(--font-size-s\)/);
		expect(h2).not.toMatch(/text-transform/);
		const weight = /font-weight:\s*var\(--weight-(\w+)\)/.exec(h2)?.[1];
		expect(['regular', 'medium', 'strong']).toContain(weight);
	});

	it('keeps its states: loading, error with Try again, empty', async () => {
		const retry = vi.fn();
		const { unmount } = render(WidgetCard, { title: 'Activity', headingId: 'h', status: 'loading', loadingText: 'Loading activity…' });
		expect(screen.getByRole('region', { name: 'Activity' })).toBeTruthy();
		expect(screen.getByText('Loading activity…')).toBeTruthy();
		unmount();
		const second = render(WidgetCard, { title: 'Activity', headingId: 'h', status: 'error', error: 'Boom', onretry: retry });
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(retry).toHaveBeenCalled();
		second.unmount();
		render(WidgetCard, { title: 'Activity', headingId: 'h', status: 'empty', emptyText: 'Nothing yet' });
		expect(screen.getByText('Nothing yet')).toBeTruthy();
	});
});
