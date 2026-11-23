import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

// A refused upload shows the catalogue text of its code; only pack_invalid adds the validator's English reason, in
// a details element marked as English (#168, spec Ruling). No other server sentence reaches the page.
const { stagePack } = vi.hoisted(() => ({ stagePack: vi.fn() }));
vi.mock('$lib/api/packs', () => ({
	discardStaged: vi.fn(),
	installStaged: vi.fn(),
	listPacks: vi.fn(async () => []),
	stagePack,
	uninstallPack: vi.fn(),
	waitForImport: vi.fn()
}));
vi.mock('$lib/api/packages', () => ({ getCatalogue: vi.fn(async () => ({ format: 1, languages: [], building: false, packages: [] })) }));

import PackManager from './PackManager.svelte';

afterEach(() => {
	cleanup();
	stagePack.mockReset();
});

async function upload(): Promise<void> {
	render(PackManager);
	const input = (await screen.findByLabelText(/pack/i, { selector: 'input[type="file"]' })) as HTMLInputElement;
	await fireEvent.change(input, { target: { files: [new File(['x'], 'p.zip')] } });
	await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
}

describe('PackManager upload errors', () => {
	it('pack_invalid: the catalogue text, and the reason as English detail', async () => {
		stagePack.mockRejectedValue(
			new ApiError(400, JSON.stringify({ error: 'pack_invalid', message: 'invalid pack: license is required' }))
		);
		await upload();
		expect((await screen.findByRole('alert')).textContent).toBe('This is not a valid pack.');
		const detail = document.querySelector('details.detail');
		expect(detail?.querySelector('summary')?.textContent).toBe('Server detail (English)');
		expect(detail?.textContent).toContain('invalid pack: license is required');
	});

	it('any other refusal: the catalogue text only', async () => {
		stagePack.mockRejectedValue(
			new ApiError(429, JSON.stringify({ error: 'pack_staged', message: 'Finish or discard a staged pack first.' }))
		);
		await upload();
		expect((await screen.findByRole('alert')).textContent).toBe('A pack is waiting for review. Install or discard it first.');
		expect(document.querySelector('details.detail')).toBeNull();
		expect(document.body.textContent).not.toContain('Finish or discard');
	});
});
