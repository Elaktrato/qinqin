import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { SenseView } from '$lib/api/types';
import { workspaces } from '$lib/workspaces';
import Senses from './Senses.svelte';

function sense(dictionaryId: number, name: string, gloss: string): SenseView {
	return { dictionaryId, dictionaryName: name, packId: name, license: '', attribution: '', gloss };
}

function hide(ids: unknown): void {
	const ws = { id: 1, language: 'zh', name: '', settings: { hiddenDictionaries: ids }, updatedAt: 't' };
	workspaces.set({ list: [ws], current: ws });
}

afterEach(() => {
	cleanup();
	workspaces.set({ list: [], current: null });
});

describe('Senses with hidden dictionaries', () => {
	const senses = [sense(1, 'CEDICT', 'hello'), sense(2, 'Unihan', 'greeting')];

	it('collapses hidden senses behind a button that reveals them', async () => {
		hide([2]);
		render(Senses, { senses });
		expect(screen.queryByText('greeting')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Show 1 from hidden dictionaries' }));
		expect(screen.getByText('greeting')).toBeTruthy();
	});

	it('never renders an empty entry when every dictionary is hidden', () => {
		hide([1, 2]);
		render(Senses, { senses });
		expect(screen.getByText('hello')).toBeTruthy();
		expect(screen.getByText('Shown although its dictionaries are hidden in this workspace')).toBeTruthy();
	});

	it('ignores stale ids', () => {
		hide([99, 'x']);
		render(Senses, { senses });
		expect(screen.getByText('greeting')).toBeTruthy();
		expect(screen.queryByRole('button')).toBeNull();
	});
});
