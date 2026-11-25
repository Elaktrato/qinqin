import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$lib/api/types';

const { fetchComponents, fetchCharacters } = vi.hoisted(() => ({ fetchComponents: vi.fn(), fetchCharacters: vi.fn() }));
vi.mock('$lib/api/components', async (original) => ({ ...(await original<typeof import('$lib/api/components')>()), fetchComponents }));
vi.mock('$lib/api/characters', async (original) => ({ ...(await original<typeof import('$lib/api/characters')>()), fetchCharacters }));

import Anatomy from './Anatomy.svelte';

function open(props: { char: string; radical?: string; heading?: 2 | 3 | null }, settings: Record<string, unknown> = {}) {
	const ctx: TestContext = testContext();
	const ws: Workspace = { id: 4, language: 'ja', name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	return render(Anatomy, { props: { language: 'ja', ...props }, context: ctx.context });
}

beforeEach(() => {
	fetchComponents.mockReset().mockResolvedValue({ packs: [], parts: [], chars: { 語: ['言', '口', '吾'], 明: ['日', '月'] } });
	fetchCharacters.mockReset().mockResolvedValue({ chars: [{ i: 1, c: '言', m: 'say' }, { i: 2, c: '口', m: 'mouth' }], count: 2 });
});
afterEach(cleanup);

describe('Anatomy (#212)', () => {
	it('lists the parts with their meanings and marks the radical, under a heading', async () => {
		const view = open({ char: '語', radical: '言' });
		await view.findByTestId('anatomy');
		expect(view.getByRole('heading', { name: 'Parts', level: 2 })).toBeTruthy();
		const items = [...document.querySelectorAll('li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
		expect(items).toEqual(['言 say radical', '口 mouth', '吾']);
	});

	it('draws the title as a label inside a card (heading null)', async () => {
		const view = open({ char: '語', heading: null });
		await view.findByTestId('anatomy');
		expect(view.queryByRole('heading')).toBeNull();
		expect(view.getByText('Parts')).toBeTruthy();
	});

	it('shows nothing for a character with no parts, when the aid is off, or when the packs fail', async () => {
		const none = open({ char: '木' });
		await waitFor(() => expect(fetchComponents).toHaveBeenCalled());
		expect(none.queryByTestId('anatomy')).toBeNull();
		cleanup();
		fetchComponents.mockClear();
		const off = open({ char: '語' }, { visualAids: { anatomy: false } });
		await Promise.resolve();
		expect(off.queryByTestId('anatomy')).toBeNull();
		expect(fetchComponents).not.toHaveBeenCalled();
		cleanup();
		fetchComponents.mockRejectedValue(new Error('down'));
		const failed = open({ char: '語' });
		await waitFor(() => expect(fetchComponents).toHaveBeenCalled());
		expect(failed.queryByTestId('anatomy')).toBeNull();
	});
});
