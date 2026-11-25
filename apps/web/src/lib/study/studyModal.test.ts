import { describe, expect, it } from 'vitest';
import { StudyModalState } from './studyModal.svelte';

describe('StudyModalState', () => {
	it('opens and closes', () => {
		const modal = new StudyModalState();
		expect(modal.open).toBe(false);
		modal.show();
		expect(modal.open).toBe(true);
		modal.hide();
		expect(modal.open).toBe(false);
	});
});
