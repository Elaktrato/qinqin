import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PackManager from './PackManager.svelte';

const installed = [
	{ type: 'dictionary', packId: 'cedict', name: 'CC-CEDICT', version: '1', language: 'zh', license: 'CC BY-SA 4.0', attribution: 'MDBG', notice: '', updatedAt: '2026-11-01T00:00:00Z' },
	{ type: 'sentences', packId: 'zh-demo', name: 'Demo sentences', version: '1', language: 'zh', license: 'CC0-1.0', attribution: 'x', notice: '', updatedAt: '2026-11-01T00:00:00Z' }
];

const source = (type: string, packId: string) => ({ type, packId, name: packId, version: '1', license: 'x', attribution: 'a', notice: '' });
const baseRow = {
	languages: ['zh'], formatVersion: 1, requires: [], optional: false, licenseTexts: true,
	updatedAt: '2026-11-16T10:00:00Z', deletedAt: null
};
function catalogue(building: boolean, withError = false) {
	return {
		format: 1,
		instanceId: '01JD8Z3Q4M5N6P7R8S9T0V1W2X',
		languages: ['zh'],
		building,
		packages: [
			{ ...baseRow, id: 'lexicon.zh', type: 'lexicon', revision: 3, contentHash: `sha256:${'a'.repeat(64)}`, sha256: 'b'.repeat(64), bytes: 24117248, url: '/api/packages/lexicon.zh/3', state: 'ready', builtAt: '2026-11-16T10:00:00Z', sources: [source('dictionary', 'cedict')], ...(withError ? { error: 'disk full' } : {}) },
			{ ...baseRow, id: 'sentences.zh-demo', type: 'sentences', requires: ['lexicon.zh'], revision: 0, contentHash: '', sha256: '', bytes: 0, url: null, state: 'building', builtAt: null, sources: [source('sentences', 'zh-demo')] }
		]
	};
}

let cat: () => Response;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
	cat = () => json(catalogue(true));
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input), 'http://localhost');
			if (url.pathname === '/api/admin/packs') return json(installed);
			if (url.pathname === '/api/packages') {
				expect(url.searchParams.get('languages')).toBe('all');
				return cat();
			}
			return json([]);
		})
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('Settings > Data: package state per pack', () => {
	it('shows each pack its package (revision, size in MB, state) and that packages are being built', async () => {
		render(PackManager);
		const item = (await screen.findByText('CC-CEDICT', { selector: 'strong' })).closest('li')!;
		await waitFor(() => expect(within(item).getByText(/lexicon\.zh: revision 3, 23\.0 MB, ready/)).toBeTruthy());
		const sentences = screen.getByText('Demo sentences', { selector: 'strong' }).closest('li')!;
		expect(within(sentences).getByText(/sentences\.zh-demo: being built/)).toBeTruthy();
		expect(screen.getByText('Packages are being built')).toBeTruthy();
	});

	it('shows the build error text of a package', async () => {
		cat = () => json(catalogue(false, true));
		render(PackManager);
		await screen.findByText('CC-CEDICT', { selector: 'strong' });
		await waitFor(() => expect(screen.getByText(/disk full/)).toBeTruthy());
		expect(screen.queryByText('Packages are being built')).toBeNull();
	});

	it('keeps the pack list when the catalogue cannot be read', async () => {
		cat = () => json({ nope: 1 });
		render(PackManager);
		await screen.findByText('CC-CEDICT', { selector: 'strong' });
		await waitFor(() => expect(screen.getByText(/package state is not available/i)).toBeTruthy());
		expect(screen.getByText('Demo sentences', { selector: 'strong' })).toBeTruthy();
	});
});
