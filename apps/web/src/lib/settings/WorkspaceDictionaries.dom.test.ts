import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { Dictionary, Workspace } from '$lib/api/types';


import WorkspaceDictionaries from './WorkspaceDictionaries.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
	vi.spyOn(ctx.session.workspaces, 'setSettings').mockResolvedValue({} as never);
});

const d = (id: number, name: string): Dictionary => ({
	id, name, version: '1.0', license: '', attribution: '', packId: name, language: 'zh'
});
const ws = (hidden: unknown[]): Workspace => ({
	id: 4, language: 'zh', name: '', settings: { hiddenDictionaries: hidden }, updatedAt: 't'
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('WorkspaceDictionaries', () => {
	it('saves unticked dictionaries as hidden ids and keeps unlisted ones', async () => {
		const onclose = vi.fn();
		render(WorkspaceDictionaries, { props: {
			workspace: ws([9]),
			dictionaries: [d(1, 'CEDICT'), d(2, 'Unihan')],
			admin: true,
			onclose
		}, context: ctx.context });
		await fireEvent.click(screen.getByRole('checkbox', { name: /Unihan/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(ctx.session.workspaces.setSettings).toHaveBeenCalledWith(4, { hiddenDictionaries: [9, 2] }));
		expect(onclose).toHaveBeenCalled();
	});

	it('starts with hidden dictionaries unticked and closes on Escape', async () => {
		const onclose = vi.fn();
		render(WorkspaceDictionaries, { props: {
			workspace: ws([2]),
			dictionaries: [d(1, 'CEDICT'), d(2, 'Unihan')],
			admin: false,
			onclose
		}, context: ctx.context });
		expect((screen.getByRole('checkbox', { name: /Unihan/ }) as HTMLInputElement).checked).toBe(false);
		expect((screen.getByRole('checkbox', { name: /CEDICT/ }) as HTMLInputElement).checked).toBe(true);
		await fireEvent.keyDown(screen.getByRole('form'), { key: 'Escape' });
		expect(onclose).toHaveBeenCalled();
	});

	it('shows the hint for a language without dictionaries', () => {
		render(WorkspaceDictionaries, { props: { workspace: ws([]), dictionaries: [], admin: false, onclose: vi.fn() }, context: ctx.context });
		expect(screen.getByText(/Ask the administrator of this server/)).toBeTruthy();
	});
});
