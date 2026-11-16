import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apply } = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock('./register', async () => {
	const { writable } = await import('svelte/store');
	const updateAvailable = writable(false);
	return { updateAvailable, applyUpdate: apply };
});

import type { Writable } from 'svelte/store';
import { updateAvailable as available } from './register';
import UpdateBanner from './UpdateBanner.svelte';

// The mock above swaps the readable for a writable.
const updateAvailable = available as Writable<boolean>;

afterEach(() => {
	cleanup();
	updateAvailable.set(false);
	apply.mockClear();
});

describe('UpdateBanner', () => {
	it('shows nothing without an update', () => {
		render(UpdateBanner);
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('announces an update politely and Reload applies it', async () => {
		updateAvailable.set(true);
		render(UpdateBanner);
		const status = screen.getByRole('status');
		expect(status.textContent).toContain('A new version of qinqin is available.');
		await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
		expect(apply).toHaveBeenCalledTimes(1);
	});
});
