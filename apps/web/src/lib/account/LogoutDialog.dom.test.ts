import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '$lib/auth';
import { setOutboxUser } from '$lib/study/outboxUser';
import { logoutPrompt } from './logoutFlow';
import { requestSignOut } from './signOut';
import LogoutDialog from './LogoutDialog.svelte';

function queue(userId: number, ids: string[]): void {
	localStorage.setItem(
		'qinqin.study.pending.v2',
		JSON.stringify(
			ids.map((id) => ({
				userId,
				queuedAt: new Date().toISOString(),
				event: { id, workspaceId: 1, device: 'web', ts: 't', type: 'review', payload: {} }
			}))
		)
	);
}

beforeEach(() => {
	// jsdom has no <dialog>.showModal
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute('open', '');
	};
	localStorage.clear();
	localStorage.setItem('qinqin.token', 'tok');
	auth.set({ token: 'tok', user: { id: 1, username: 'u' } as never });
	setOutboxUser(1, 'tok');
	logoutPrompt.set(null);
	vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	setOutboxUser(null, null);
});

describe('sign-out with unsent reviews', () => {
	it('signs out at once when nothing is queued', async () => {
		await requestSignOut();
		expect(localStorage.getItem('qinqin.token')).toBeNull();
		let value: number | null = -1;
		logoutPrompt.subscribe((v) => (value = v))();
		expect(value).toBeNull();
	});

	it('asks, with Stay signed in focused, when reviews cannot be sent', async () => {
		queue(1, ['a', 'b']);
		await requestSignOut();
		expect(localStorage.getItem('qinqin.token')).toBe('tok');
		render(LogoutDialog);
		expect(screen.getByText('2 reviews have not been sent yet. If you sign out now they are deleted from this device.')).toBeTruthy();
		expect(document.activeElement?.textContent).toBe('Stay signed in');
	});

	it('Stay keeps the token and the queue; Escape does the same', async () => {
		queue(1, ['a']);
		await requestSignOut();
		const { container } = render(LogoutDialog);
		await fireEvent.click(screen.getByText('Stay signed in'));
		expect(localStorage.getItem('qinqin.token')).toBe('tok');
		expect(localStorage.getItem('qinqin.study.pending.v2')).not.toBeNull();
		logoutPrompt.set(1);
		await fireEvent(container.querySelector('dialog')!, new Event('cancel', { cancelable: true }));
		let value: number | null = -1;
		logoutPrompt.subscribe((v) => (value = v))();
		expect(value).toBeNull();
		expect(localStorage.getItem('qinqin.token')).toBe('tok');
	});

	it('Sign out and delete them clears the queue and the session', async () => {
		queue(1, ['a']);
		await requestSignOut();
		render(LogoutDialog);
		await fireEvent.click(screen.getByText('Sign out and delete them'));
		expect(localStorage.getItem('qinqin.token')).toBeNull();
		expect(localStorage.getItem('qinqin.study.pending.v2')).toBeNull();
	});

	it("keeps another user's queue when this one deletes theirs", async () => {
		localStorage.setItem(
			'qinqin.study.pending.v2',
			JSON.stringify(
				[1, 2].map((u) => ({ userId: u, queuedAt: new Date().toISOString(), event: { id: `e${u}`, workspaceId: 1, device: 'web', ts: 't', type: 'review', payload: {} } }))
			)
		);
		await requestSignOut();
		render(LogoutDialog);
		await fireEvent.click(screen.getByText('Sign out and delete them'));
		const left = JSON.parse(localStorage.getItem('qinqin.study.pending.v2') ?? '[]');
		expect(left.map((i: { userId: number }) => i.userId)).toEqual([2]);
	});
});
