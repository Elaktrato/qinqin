import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/languages', () => ({ listLanguages: vi.fn() }));

import { listLanguages } from '$lib/api/languages';
import { primaryActions } from '$lib/ui/testing/primary';
import { workspaces } from '$lib/workspaces';
import WorkspaceCreateForm from './WorkspaceCreateForm.svelte';

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('WorkspaceCreateForm in the lighter look (#106)', () => {
	it('has one primary action, an underline select and an underline name field', async () => {
		vi.mocked(listLanguages).mockResolvedValue([
			{ code: 'zh', name: 'Chinese', installed: true, kind: 'code' }
		] as never);
		workspaces.set({ list: [], current: null });
		render(WorkspaceCreateForm, { idPrefix: 'test-new' });

		await screen.findByLabelText('Language');
		const select = screen.getByLabelText('Language');
		const name = screen.getByLabelText('Name (optional)');
		expect(select.tagName).toBe('SELECT');
		expect(select.closest('.field')).toBeTruthy();
		expect(name.closest('.field')).toBeTruthy();
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Create workspace' }).className).toContain('primary');
	});
});
