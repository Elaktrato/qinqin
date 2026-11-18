import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./store', () => ({
	getJournalSettings: vi.fn(async () => ({ guidance: '', explanationLanguage: 'en' })),
	saveJournalSettings: vi.fn(async () => {})
}));

import type { Workspace } from '$lib/api/types';
import { primaryActions } from '$lib/ui/testing/primary';
import JournalSettings from './JournalSettings.svelte';

const workspace = { id: 1, language: 'zh', name: 'Chinese', settings: {}, updatedAt: '' } as Workspace;

afterEach(cleanup);

describe('JournalSettings in the lighter look (#106)', () => {
	it('has one primary; the guidance is a multiline Field and the language a Select', async () => {
		render(JournalSettings, { workspace });
		await screen.findByRole('heading', { level: 1 });
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Save' }).className).toContain('primary');
		expect(screen.getByLabelText('Correction guidance').closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('Explanation language').closest('.field')).toBeTruthy();
	});
});
