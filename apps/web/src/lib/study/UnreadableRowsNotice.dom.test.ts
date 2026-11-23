import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import UnreadableRowsNotice from './UnreadableRowsNotice.svelte';
import { clearUnreadableReport, unreadableRows } from './unreadable';

afterEach(() => {
	cleanup();
	clearUnreadableReport();
});

describe('UnreadableRowsNotice', () => {
	it('shows the report of the shown workspace as a status', async () => {
		unreadableRows.set({ workspaceId: 7, counts: { cards: 3 }, total: 3 });
		render(UnreadableRowsNotice, { workspaceId: 7 });
		expect(screen.getByRole('status').textContent).toMatch(/3 saved study items could not be read/);
	});
	it('shows nothing for another workspace or without a report', () => {
		unreadableRows.set({ workspaceId: 9, counts: { cards: 3 }, total: 3 });
		render(UnreadableRowsNotice, { workspaceId: 7 });
		expect(screen.queryByRole('status')).toBeNull();
	});
});
