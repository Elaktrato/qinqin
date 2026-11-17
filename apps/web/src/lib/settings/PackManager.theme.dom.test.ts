import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StagedPack } from '$lib/api/packs';

const staged: StagedPack = {
	token: 'tok',
	expiresAt: '2026-11-17T12:00:00Z',
	manifest: {
		id: 'paper-themes',
		name: 'Paper themes',
		version: '1.0',
		type: 'theme',
		language: '',
		license: 'MIT',
		attribution: '© 2026 Paper',
		notice: '',
		format: 'themes-json'
	},
	replaces: null,
	files: 3,
	bytes: 2048,
	themes: [
		{
			id: 'paper',
			name: 'Paper',
			family: '',
			scheme: 'light',
			checks: [
				{ fg: 'text', bg: 'panel', min: 4.5, ratio: 9.1, pass: true },
				{ fg: 'accent:sky', bg: 'panel', min: 3, ratio: 2.47, pass: false }
			],
			failing: 1
		},
		{
			id: 'ink',
			name: 'Ink',
			family: '',
			scheme: 'dark',
			checks: [{ fg: 'text', bg: 'panel', min: 4.5, ratio: 11, pass: true }],
			failing: 0
		}
	]
};

vi.mock('$lib/api/packs', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/packs')>()),
	listPacks: vi.fn(async () => [
		{ type: 'theme', packId: 'old-themes', name: 'Old themes', version: '1', language: '', license: 'MIT', attribution: 'x', notice: '', updatedAt: '' }
	]),
	stagePack: vi.fn(async () => staged),
	discardStaged: vi.fn(async () => {})
}));

import PackManager from './PackManager.svelte';

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('{"format":1,"packages":[],"languages":[],"building":false}', { status: 200, headers: { 'content-type': 'application/json' } }))
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

async function stage(): Promise<HTMLElement> {
	const { container } = render(PackManager);
	const input = container.querySelector('input[type="file"]') as HTMLInputElement;
	const file = new File(['zip'], 'paper.zip', { type: 'application/zip' });
	Object.defineProperty(input, 'files', { value: [file] });
	await fireEvent.change(input);
	const upload = screen.getAllByRole('button').find((b) => /upload/i.test(b.textContent ?? ''));
	if (upload) await fireEvent.click(upload);
	return screen.findByRole('region', { name: 'Review before installing' });
}

describe('Settings > Data: a staged theme pack', () => {
	it('shows a contrast table per theme with the result in words, and no language line', async () => {
		const review = await stage();
		expect(within(review).queryByText('Language')).toBeNull();
		const tables = within(review).getAllByRole('table');
		expect(tables).toHaveLength(2);
		expect(within(tables[0]).getByRole('columnheader', { name: 'Pair' })).toBeTruthy();
		const row = within(tables[0]).getByRole('row', { name: /Accent sky on panel/ });
		expect(within(row).getByText('2.47:1')).toBeTruthy();
		expect(within(row).getByText('3:1')).toBeTruthy();
		expect(within(row).getByText('Below')).toBeTruthy();
		expect(within(tables[0]).getByText('Passes')).toBeTruthy();
		expect(within(review).getByText('Paper (light): 1 check is below its minimum.')).toBeTruthy();
		expect(within(review).getByText('Ink (dark): every check passes.')).toBeTruthy();
		expect(within(review).getByText(/1 check is below its minimum\. The pack may still be installed/)).toBeTruthy();
	});

	it('lists installed theme packs under Themes', async () => {
		render(PackManager);
		expect(await screen.findByRole('heading', { name: 'Themes' })).toBeTruthy();
		expect(screen.getByText('Old themes', { selector: 'strong' })).toBeTruthy();
	});
});
