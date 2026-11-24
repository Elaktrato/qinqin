import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaces } from '$lib/workspaces';
import { captureInstallPrompt, installPrompt } from './install';
import { resetOffline, setPrepared } from './offlineState';
import AppSection from './AppSection.svelte';
import { FakeCacheStorage } from '../testing/fakeCaches';
import { ownPartition } from './partitions';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

let fake: FakeCacheStorage;
async function receipt(user: number, entries: number, withPartition = true): Promise<void> {
	localStorage.setItem(`qinqin.pwa.prepared.${user}.7`, JSON.stringify({ at: new Date(2026, 10, 16, 14, 2).getTime(), cards: 5, reviews: 2, entries, partition: await ownPartition('t') }));
	if (withPartition) await fake.open(await ownPartition('t'));
}

const me = { id: 1, username: 'a', admin: false, email: null, emailVerified: false, mustChangePassword: false, createdAt: 't' };

function secure(value: boolean): void {
	Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
}

beforeEach(() => {
	fake = new FakeCacheStorage();
	vi.stubGlobal('caches', fake);
	localStorage.setItem('qinqin.token', 't');
	resetOffline();
	installPrompt.set(null);
	ctx.app.auth.set({ token: 't', user: me });
	workspaces.set({ list: [{ id: 7, language: 'zh', name: '' } as never], current: { id: 7, language: 'zh', name: '' } as never });
	secure(true);
	Object.defineProperty(navigator, 'storage', {
		value: { estimate: async () => ({ usage: 12.3 * 1024 * 1024, quota: 4.2 * 1024 ** 3 }) },
		configurable: true
	});
});
afterEach(() => {
	vi.unstubAllGlobals();
	cleanup();
	localStorage.clear();
	vi.restoreAllMocks();
});

describe('Settings -> Account -> App', () => {
	it('insecure context: the HTTPS note and nothing else', () => {
		secure(false);
		render(AppSection, { context: ctx.context });
		expect(screen.getByText(/need HTTPS/)).toBeTruthy();
		expect(screen.queryByRole('button')).toBeNull();
	});

	it('shows Install only after the browser offered it, and prompts on click', async () => {
		render(AppSection, { context: ctx.context });
		expect(screen.queryByRole('button', { name: 'Install qinqin' })).toBeNull();
		const prompt = vi.fn(async () => {});
		const off = captureInstallPrompt(window);
		window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) }));
		const button = await screen.findByRole('button', { name: 'Install qinqin' });
		await fireEvent.click(button);
		expect(prompt).toHaveBeenCalled();
		off();
	});

	it('iOS text without a prompt', () => {
		vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
		render(AppSection, { context: ctx.context });
		expect(screen.getByText(/tap Share, then Add to Home Screen/)).toBeTruthy();
	});

	it('offline status from the receipt of the active workspace', async () => {
		await receipt(1, 120);
		render(AppSection, { context: ctx.context });
		expect(await screen.findByText('Offline: ready - 120 cards saved at 14:02')).toBeTruthy();
	});

	it('never "ready" for an empty partition (receipt kept, cache gone)', async () => {
		await receipt(1, 120, false);
		render(AppSection, { context: ctx.context });
		await new Promise((r) => setTimeout(r, 20));
		expect(screen.getByText(/Offline: not prepared yet/)).toBeTruthy();
	});

	it('never "ready" for a receipt written under another login', async () => {
		await receipt(1, 120);
		localStorage.setItem('qinqin.token', 'other-login');
		render(AppSection, { context: ctx.context });
		await new Promise((r) => setTimeout(r, 20));
		expect(screen.getByText(/Offline: not prepared yet/)).toBeTruthy();
	});

	it('another user\'s receipt is not shown', async () => {
		await receipt(2, 120);
		render(AppSection, { context: ctx.context });
		expect(screen.getByText(/Offline: not prepared yet/)).toBeTruthy();
	});

	it('storage use appears from the estimate', async () => {
		render(AppSection, { context: ctx.context });
		expect(await screen.findByText('Storage used: 12.3 MB of 4.2 GB')).toBeTruthy();
	});

	it('Clear offline data removes receipts, keeps the review outbox, and says so', async () => {
		await receipt(1, 3);
		localStorage.setItem('qinqin.study.pending.v2', '[{"x":1}]');
		setPrepared({ workspaceId: 7, cards: 3, at: new Date().toISOString() });
		render(AppSection, { context: ctx.context });
		await fireEvent.click(screen.getByRole('button', { name: 'Clear offline data' }));
		await waitFor(() => expect(screen.getByText(/Offline data cleared/)).toBeTruthy());
		expect(localStorage.getItem('qinqin.pwa.prepared.1.7')).toBeNull();
		expect(localStorage.getItem('qinqin.study.pending.v2')).not.toBeNull();
		expect(screen.getByText(/Offline: not prepared yet/)).toBeTruthy();
	});
});
