import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntryPicture as Picture } from '$lib/api/images';
import type { Workspace } from '$lib/api/types';

const { entryPicture } = vi.hoisted(() => ({ entryPicture: vi.fn() }));
vi.mock('$lib/api/images', async (original) => ({ ...(await original<typeof import('$lib/api/images')>()), entryPicture }));

import EntryPicture from './EntryPicture.svelte';

const picture: Picture = {
	packId: 'images-openmoji',
	concept: '1F34E',
	label: 'red apple',
	credit: 'OpenMoji, Liz Bravo',
	license: 'CC BY-SA 4.0',
	attribution: '',
	basis: 'gloss',
	sense: 0,
	score: 90,
	svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><path fill="#000" stroke="#000000" d="M0 0"/></svg>'
};

let ctx: TestContext;
function open(settings: Record<string, unknown> = {}, id = 7) {
	ctx = testContext();
	const ws: Workspace = { id: 4, language: 'ja', name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	return render(EntryPicture, { props: { entryId: id }, context: ctx.context });
}

beforeEach(() => entryPicture.mockReset());
afterEach(cleanup);

describe('EntryPicture (#212)', () => {
	it('draws the picture from the theme, names it and credits it', async () => {
		entryPicture.mockResolvedValue(picture);
		const view = open();
		const figure = await view.findByTestId('entry-picture');
		const art = figure.querySelector('[role="img"]');
		expect(art?.getAttribute('aria-label')).toBe('red apple');
		expect(art?.innerHTML).toContain('currentColor');
		expect(art?.innerHTML).not.toContain('#000');
		expect(figure.querySelector('figcaption')?.textContent).toBe('OpenMoji, Liz Bravo, CC BY-SA 4.0');
	});

	it('never turns a picture into HTML: a comment that HTML closes early draws nothing (v0.8.0 review)', async () => {
		const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><!--><img/src="x"/onerror="alert(1)">--></svg>';
		entryPicture.mockResolvedValue({ ...picture, svg: hostile });
		const view = open();
		const figure = await view.findByTestId('entry-picture');
		expect(figure.querySelector('img, script, [onerror]')).toBeNull();
		expect(figure.querySelector('[role="img"]')?.innerHTML).toBe('');
	});

	it('asks once per entry for the whole session', async () => {
		entryPicture.mockResolvedValue(picture);
		const view = open();
		await view.findByTestId('entry-picture');
		view.unmount();
		render(EntryPicture, { props: { entryId: 7 }, context: ctx.context });
		await waitFor(() => expect(document.querySelector('[data-testid="entry-picture"]')).not.toBeNull());
		expect(entryPicture).toHaveBeenCalledTimes(1);
	});

	it('asks nothing and draws nothing when the aid is off', async () => {
		entryPicture.mockResolvedValue(picture);
		const view = open({ visualAids: { pictures: false } });
		await Promise.resolve();
		expect(view.queryByTestId('entry-picture')).toBeNull();
		expect(entryPicture).not.toHaveBeenCalled();
	});

	it('draws nothing for a word without a picture or when the request fails', async () => {
		entryPicture.mockResolvedValueOnce(null);
		const none = open({}, 1);
		await waitFor(() => expect(entryPicture).toHaveBeenCalledTimes(1));
		expect(none.queryByTestId('entry-picture')).toBeNull();
		cleanup();
		entryPicture.mockRejectedValueOnce(new Error('offline'));
		const failed = open({}, 2);
		await waitFor(() => expect(entryPicture).toHaveBeenCalledTimes(2));
		expect(failed.queryByTestId('entry-picture')).toBeNull();
	});

	it('draws nothing outside a session', () => {
		const view = render(EntryPicture, { props: { entryId: 7 } });
		expect(view.queryByTestId('entry-picture')).toBeNull();
		expect(entryPicture).not.toHaveBeenCalled();
	});
});

describe('Report picture (#274)', () => {
	afterEach(() => vi.unstubAllGlobals());

	function stubReports(status: number) {
		const sent: unknown[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (path: string, init?: RequestInit) => {
				if (path === '/api/images/reports' && init?.method === 'POST') {
					sent.push(JSON.parse(String(init.body)));
					return new Response(status === 204 ? null : '{"error":"internal","message":"x"}', { status });
				}
				return new Response('{}', { status: 404 });
			})
		);
		return sent;
	}

	it('asks why, sends the report, hides the picture and says so', async () => {
		const sent = stubReports(204);
		entryPicture.mockResolvedValueOnce(picture).mockResolvedValueOnce(null);
		const view = open();
		await view.findByTestId('entry-picture');
		await fireEvent.click(view.getByRole('button', { name: 'Report picture' }));
		const wrong = view.getByRole('button', { name: 'It shows something else' });
		expect(view.getByRole('button', { name: 'Cancel' })).toBeTruthy();
		await fireEvent.click(wrong);
		await waitFor(() => expect(view.getByRole('status').textContent).toContain('Thanks'));
		expect(sent).toEqual([{ entryId: 7, packId: 'images-openmoji', concept: '1F34E', reason: 'wrong' }]);
		await waitFor(() => expect(view.queryByTestId('entry-picture')).toBeNull());
		expect(entryPicture).toHaveBeenCalledTimes(2);
	});

	it('cancel closes the question and sends nothing', async () => {
		const sent = stubReports(204);
		entryPicture.mockResolvedValue(picture);
		const view = open();
		await view.findByTestId('entry-picture');
		await fireEvent.click(view.getByRole('button', { name: 'Report picture' }));
		await fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
		expect(view.queryByRole('button', { name: 'It shows something else' })).toBeNull();
		expect(view.getByRole('button', { name: 'Report picture' })).toBeTruthy();
		expect(sent).toEqual([]);
	});

	it('keeps the picture and shows the error when the report fails', async () => {
		stubReports(500);
		entryPicture.mockResolvedValue(picture);
		const view = open();
		await view.findByTestId('entry-picture');
		await fireEvent.click(view.getByRole('button', { name: 'Report picture' }));
		await fireEvent.click(view.getByRole('button', { name: 'It is hard to recognise' }));
		await waitFor(() => expect(view.getByRole('alert').textContent).not.toBe(''));
		expect(view.getByTestId('entry-picture')).toBeTruthy();
	});
});
