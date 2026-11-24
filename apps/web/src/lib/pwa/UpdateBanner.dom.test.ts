import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testContext } from '$lib/testing/context';
import type { WorkerRegistration } from './register.svelte';
import UpdateBanner from './UpdateBanner.svelte';

/** A context whose service worker registration reports `available` (and records apply). */
function withWorker(available: boolean) {
	const ctx = testContext();
	const worker: WorkerRegistration = { updateAvailable: available, register: async () => {}, apply: vi.fn() };
	(ctx.app as { worker: WorkerRegistration }).worker = worker;
	return { ctx, worker };
}

afterEach(() => {
	cleanup();
});

describe('UpdateBanner', () => {
	it('shows nothing without an update', () => {
		const { ctx } = withWorker(false);
		render(UpdateBanner, { context: ctx.context });
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('announces an update politely and Reload applies it', async () => {
		const { ctx, worker } = withWorker(true);
		render(UpdateBanner, { context: ctx.context });
		const status = screen.getByRole('status');
		expect(status.textContent).toContain('A new version of qinqin is available.');
		await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
		expect(worker.apply).toHaveBeenCalledTimes(1);
	});
});
