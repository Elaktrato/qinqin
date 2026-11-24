import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { testContext, type TestContext } from '$lib/testing/context';
import UnreadableRowsNotice from './UnreadableRowsNotice.svelte';

let ctx: TestContext;
beforeEach(() => {
	ctx = testContext();
});
afterEach(() => {
	cleanup();
});

describe('UnreadableRowsNotice', () => {
	it('shows the report of the shown workspace as a status', async () => {
		ctx.session.study.unreadable.record(7, { cards: 3 }, []);
		render(UnreadableRowsNotice, { props: { workspaceId: 7 }, context: ctx.context });
		expect(screen.getByRole('status').textContent).toMatch(/3 saved study items could not be read/);
	});
	it('shows nothing for another workspace or without a report', () => {
		ctx.session.study.unreadable.record(9, { cards: 3 }, []);
		render(UnreadableRowsNotice, { props: { workspaceId: 7 }, context: ctx.context });
		expect(screen.queryByRole('status')).toBeNull();
	});
});
