import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { offline, resetOffline } from './offlineState';
import OfflineBanner from './OfflineBanner.svelte';

beforeEach(resetOffline);
afterEach(cleanup);

describe('OfflineBanner', () => {
	it('renders nothing when online and calm (but keeps its live region mounted)', () => {
		const { container } = render(OfflineBanner);
		expect(container.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
	});

	it('announces offline in a polite status region, with text not colour alone', () => {
		offline.update((s) => ({ ...s, online: false, queued: 2 }));
		render(OfflineBanner);
		const status = screen.getByRole('status');
		expect(status.textContent).toContain("You're offline. 2 reviews are saved on this device");
		expect(status.getAttribute('aria-live')).not.toBe('assertive');
	});

	it('updates as the state changes', async () => {
		render(OfflineBanner);
		offline.update((s) => ({ ...s, online: false }));
		expect(await screen.findByText("You're offline. Study works with saved cards.")).toBeTruthy();
		offline.update((s) => ({ ...s, online: true }));
		await Promise.resolve();
		expect(screen.queryByText(/offline/)).toBeNull();
	});
});
