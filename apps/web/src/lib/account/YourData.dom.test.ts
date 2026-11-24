import { testContext, testUser, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';

vi.mock('$lib/api/backup', () => ({
	downloadMyData: vi.fn(), uploadRestore: vi.fn(), restoreStatus: vi.fn(), applyRestore: vi.fn(), discardRestore: vi.fn(), safetyExportTicket: vi.fn()
}));
import * as api from '$lib/api/backup';
import { primaryActions } from '$lib/ui/testing/primary';
import YourData from './YourData.svelte';

const initial = { username: 'alice', mfa: { totp: false } };
let ctx: TestContext = testContext({ user: initial as never });
beforeEach(() => {
	ctx = testContext({ user: initial as never });
});
/** The signed-in user, as `me` answered it. */
const me = { set: (user: Record<string, unknown>) => ctx.app.auth.set({ token: 'test-token', user: testUser(user as never) }) };

const zero = { workspaces: 0, events: 0, cards: 0, rows: 0, overlays: 0, sentences: 0, books: 0, bookmarks: 0, highlights: 0 };
const ready = (unresolved = 0) => ({
	status: 'ready', error: null, result: null,
	report: {
		backup: { username: 'alice', createdAt: '2026-11-15T12:00:00Z', appVersion: '0.3.0' }, replaces: { ...zero, workspaces: 3, events: 9876 },
		restores: { ...zero, workspaces: 2 }, reidentifiedEvents: 0, blocking: [], warnings: [], bytes: 2048,
		unresolved: { entries: unresolved ? [{ written: '水', language: 'zh', cards: 2, overlays: 0 }] : [], entryCount: unresolved, sentences: 0, droppedRows: unresolved }
	}
});

const file = () => new File(['zip'], 'b.zip', { type: 'application/zip' });
async function choose(): Promise<void> {
	await fireEvent.change(screen.getByLabelText('Backup file (.zip)'), { target: { files: [file()] } });
}

beforeEach(() => {
	me.set({ username: 'alice', mfa: { totp: false } });
	vi.mocked(api.uploadRestore).mockImplementation(async (_f, onProgress) => {
		onProgress?.({ loaded: 1, total: 2 });
		return { token: 'tok' };
	});
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('YourData', () => {
	it('uses a Section and Field underlines; the restore is the section primary', async () => {
		vi.mocked(api.restoreStatus).mockResolvedValueOnce(ready() as never);
		render(YourData, { context: ctx.context });
		await choose();
		await screen.findByText(/replace everything you have now/);
		expect(screen.getByLabelText('Your password').closest('.field')).toBeTruthy();
		expect(screen.getByLabelText(/Type your username/).closest('.field')).toBeTruthy();
		expect(primaryActions(document.body)).toHaveLength(1);
	});

	it('links the lookup history (#72)', () => {
		render(YourData, { context: ctx.context });
		expect(screen.getByRole('link', { name: 'Lookup history' }).getAttribute('href')).toBe('/lookups');
	});

	it('downloads through a ticket and navigates to it', async () => {
		const assign = vi.fn();
		vi.mocked(api.downloadMyData).mockImplementation(async (a) => a?.('/api/account/export/t1'));
		render(YourData, { props: { assign }, context: ctx.context });
		await fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
		await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/account/export/t1'));
	});

	it('walks upload, report, confirmation and the done state', async () => {
		vi.mocked(api.restoreStatus).mockResolvedValueOnce(ready() as never);
		vi.mocked(api.applyRestore).mockResolvedValue({ status: 'running' });
		const reload = vi.fn();
		const queue = JSON.stringify([{ userId: 1, queuedAt: 't', event: { id: 'a', workspaceId: 7, ts: 't', type: 'review', device: 'web', payload: {} } }, { userId: 1, queuedAt: 't', event: { id: 'b', workspaceId: 7, ts: 't', type: 'review', device: 'web', payload: {} } }, { userId: 2, queuedAt: 't', event: { id: 'bob', workspaceId: 7, ts: 't', type: 'review', device: 'web', payload: {} } }, { userId: 1, queuedAt: 't', event: { id: 'c', workspaceId: 7, ts: 't', type: 'review', device: 'web', payload: {} } }]);
		const storage = { getItem: (k: string) => (k === 'qinqin.study.pending.v2' ? queue : null), setItem: vi.fn(), removeItem: vi.fn() };
		render(YourData, { props: { reload, storage }, context: ctx.context });
		await choose();
		expect(api.uploadRestore).toHaveBeenCalled();
		expect(await screen.findByText(/replace everything you have now: 3 workspaces, 9,876 study events/)).toBeTruthy();
		expect(screen.getByText(/From the backup \(made 2026-11-15\): 2 workspaces/)).toBeTruthy();
		const restore = screen.getByRole('button', { name: 'Restore' }) as HTMLButtonElement;
		expect(restore.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText('Your password'), { target: { value: 'pw' } });
		await fireEvent.input(screen.getByLabelText(/Type your username/), { target: { value: 'alice' } });
		expect(restore.disabled).toBe(false);
		vi.mocked(api.restoreStatus).mockResolvedValueOnce({ status: 'done', error: null, report: null, result: { restored: zero, droppedRows: 0, revokedSessions: 2 } } as never);
		await fireEvent.click(restore);
		await waitFor(() => expect(api.applyRestore).toHaveBeenCalledWith('tok', { confirm: 'alice', password: 'pw', code: undefined, unresolved: undefined }));
		expect(await screen.findByText(/Your data was restored/, {}, { timeout: 3000 })).toBeTruthy();
		expect(screen.getByRole('status').textContent).toContain('3 reviews waiting on this device');
		expect(storage.removeItem).toHaveBeenCalledWith('qinqin.workspace');
		// bob's unsent review stays (#198 review, M1)
		expect(JSON.parse(vi.mocked(storage.setItem).mock.calls[0][1]).map((i: { event: { id: string } }) => i.event.id)).toEqual(['bob']);
		await fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));
		expect(reload).toHaveBeenCalled();
	});

	it('shows a progress bar while uploading', async () => {
		let release: (v: { token: string }) => void = () => undefined;
		vi.mocked(api.uploadRestore).mockImplementation((_f, onProgress) => new Promise((res) => { onProgress?.({ loaded: 1, total: 4 }); release = res; }));
		vi.mocked(api.restoreStatus).mockResolvedValue({ status: 'validating', error: null, report: null, result: null } as never);
		render(YourData, { context: ctx.context });
		await choose();
		const bar = await screen.findByRole('progressbar');
		expect(bar.getAttribute('aria-valuenow')).toBe('25');
		release({ token: 't' });
		cleanup();
	});

	it('needs the acknowledgement for missing words and the code for two-factor users', async () => {
		me.set({ username: 'alice', mfa: { totp: true } });
		vi.mocked(api.restoreStatus).mockResolvedValueOnce(ready(1) as never);
		render(YourData, { context: ctx.context });
		await choose();
		expect(await screen.findByText('水 (2 cards)')).toBeTruthy();
		await fireEvent.input(screen.getByLabelText('Your password'), { target: { value: 'pw' } });
		await fireEvent.input(screen.getByLabelText(/Type your username/), { target: { value: 'alice' } });
		const restore = screen.getByRole('button', { name: 'Restore' }) as HTMLButtonElement;
		expect(restore.disabled).toBe(true);
		await fireEvent.click(screen.getByLabelText(/Drop them and restore the rest/));
		expect(restore.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText(/Authenticator or recovery code/), { target: { value: '123456' } });
		expect(restore.disabled).toBe(false);
	});

	it('offers a current-data download first and reports errors in an alert', async () => {
		vi.mocked(api.restoreStatus).mockResolvedValueOnce(ready() as never);
		vi.mocked(api.applyRestore).mockRejectedValue(new ApiError(403, JSON.stringify({ error: 'wrong_password', message: 'x' })));
		const assign = vi.fn();
		vi.mocked(api.downloadMyData).mockImplementation(async (a) => a?.('/x'));
		render(YourData, { props: { assign }, context: ctx.context });
		await choose();
		await fireEvent.click(await screen.findByRole('button', { name: 'Download a backup of my current data first' }));
		await waitFor(() => expect(assign).toHaveBeenCalled());
		await fireEvent.input(screen.getByLabelText('Your password'), { target: { value: 'bad' } });
		await fireEvent.input(screen.getByLabelText(/Type your username/), { target: { value: 'alice' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
		expect((await screen.findByRole('alert')).textContent).toBe('The password is wrong.');
	});

	it('says why an invalid file was refused', async () => {
		vi.mocked(api.restoreStatus).mockResolvedValueOnce({ status: 'invalid', report: null, result: null, error: { code: 'backup_version_unsupported', message: 'm' } } as never);
		render(YourData, { context: ctx.context });
		await choose();
		expect((await screen.findByRole('alert')).textContent).toContain('format this server cannot read');
	});

	it('lets you pick a file again after a failed restore and lists duplicates', async () => {
		const r = ready();
		r.report.warnings = ['same', 'same'] as never;
		let calls = 0;
		const failed = { status: 'failed', report: null, result: null, error: { code: 'internal', message: 'The restore failed.' } };
		vi.mocked(api.restoreStatus).mockImplementation((async () => (calls++ === 0 ? r : failed)) as never);
		vi.mocked(api.applyRestore).mockResolvedValue({ status: 'running' });
		render(YourData, { context: ctx.context });
		await choose();
		expect((await screen.findAllByText('same')).length).toBe(2);
		await fireEvent.input(screen.getByLabelText('Your password'), { target: { value: 'pw' } });
		await fireEvent.input(screen.getByLabelText(/Type your username/), { target: { value: 'alice' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
		expect((await screen.findByText(/Nothing was changed/, {}, { timeout: 3000 })).textContent).toContain('Nothing was changed');
		expect(screen.getByLabelText('Backup file (.zip)')).toBeTruthy();
	});
});
