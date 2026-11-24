import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testContext, type TestContext } from '$lib/testing/context';
import OfflineBanner from './OfflineBanner.svelte';

let ctx: TestContext;
beforeEach(() => {
	ctx = testContext();
});
afterEach(cleanup);

describe('OfflineBanner', () => {
	it('renders nothing when online and calm (but keeps its live region mounted)', () => {
		const { container } = render(OfflineBanner, { context: ctx.context });
		expect(container.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
	});

	it('announces offline in a polite status region, with text not colour alone', () => {
		ctx.app.offline.reportNetworkFailure();
		ctx.app.offline.setQueued(2);
		render(OfflineBanner, { context: ctx.context });
		const status = screen.getByRole('status');
		expect(status.textContent).toContain("You're offline. 2 reviews are saved on this device");
		expect(status.getAttribute('aria-live')).not.toBe('assertive');
	});

	it('updates as the state changes', async () => {
		render(OfflineBanner, { context: ctx.context });
		ctx.app.offline.reportNetworkFailure();
		expect(await screen.findByText("You're offline. Study works with saved cards.")).toBeTruthy();
		ctx.app.offline.reportOnline();
		await Promise.resolve();
		expect(screen.queryByText(/offline/)).toBeNull();
	});
});
