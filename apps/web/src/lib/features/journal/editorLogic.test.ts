import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client';
import {
	canGotoAfterFirstSave,
	isEntryGone,
	navigationPlan,
	tooLongHint,
	aiButtonGate,
	editorTarget,
	listedAnnotations,
	reviewAnnouncement,
	saveStatusText
} from './editorLogic';
import type { Annotation } from './types';

function ann(id: string): Annotation {
	return { id, quote: id, prefix: '', suffix: '', correction: 'x', explanation: '', category: 'other', kind: 'mistake' };
}

describe('aiButtonGate', () => {
	it('enables Review when AI works and the text fits', () => {
		expect(aiButtonGate({ available: true, banner: null, chars: 100, forReview: true })).toEqual({
			enabled: true,
			hint: null,
			settingsLink: false
		});
	});

	it('uses the banner as the hint when AI is unavailable', () => {
		const gate = aiButtonGate({ available: false, banner: 'AI features are off: x', chars: 1, forReview: true });
		expect(gate.enabled).toBe(false);
		expect(gate.hint).toBe('AI features are off: x');
		expect(gate.settingsLink).toBe(true);
	});

	it('asks for a key when there is no banner', () => {
		const gate = aiButtonGate({ available: false, banner: null, chars: 1, forReview: false });
		expect(gate.hint).toBe('Add an API key in Settings → AI');
		expect(gate.settingsLink).toBe(true);
	});

	it('limits Review, but not Ideas, to 5,000 code points', () => {
		const long = { available: true, banner: null, chars: 5001 };
		const review = aiButtonGate({ ...long, forReview: true });
		expect(review.enabled).toBe(false);
		expect(review.hint).toBe('Shorten the entry to 5,000 characters to review it');
		expect(review.settingsLink).toBe(false);
		expect(aiButtonGate({ ...long, forReview: false }).enabled).toBe(true);
		expect(aiButtonGate({ available: true, banner: null, chars: 5000, forReview: true }).enabled).toBe(true);
	});

	it('does not review an empty entry', () => {
		const gate = aiButtonGate({ available: true, banner: null, chars: 0, forReview: true });
		expect(gate.enabled).toBe(false);
		expect(gate.hint).toBe('Write something first');
	});

	it('waits while capabilities are unknown', () => {
		const gate = aiButtonGate({ available: null, banner: null, chars: 10, forReview: true });
		expect(gate.enabled).toBe(false);
		expect(gate.hint).toBeNull();
	});
});


describe('listedAnnotations', () => {
	it('keeps the review order and leaves out missing ones', () => {
		const all = [ann('a'), ann('b'), ann('c'), ann('d')];
		const listed = listedAnnotations(all, {
			placed: [
				{ annotation: all[2], start: 0, end: 1 },
				{ annotation: all[0], start: 5, end: 6 }
			],
			listOnly: [all[3]],
			missing: [all[1]]
		});
		expect(listed.map((a) => a.id)).toEqual(['a', 'c', 'd']);
	});
});

describe('reviewAnnouncement', () => {
	it('counts corrections and missing notes', () => {
		expect(reviewAnnouncement(0, 0)).toBe('Review ready: no corrections.');
		expect(reviewAnnouncement(1, 0)).toBe('Review ready: 1 correction.');
		expect(reviewAnnouncement(3, 2)).toBe('Review ready: 3 corrections, 2 no longer in the text.');
	});
});

describe('saveStatusText', () => {
	it('names each state', () => {
		expect(saveStatusText('idle')).toBe('');
		expect(saveStatusText('dirty')).toBe('Unsaved changes');
		expect(saveStatusText('saving')).toBe('Saving…');
		expect(saveStatusText('saved')).toBe('Saved');
		expect(saveStatusText('error')).toBe('Not saved. Retrying when you keep typing, or press Save.');
	});
});

describe('editorTarget', () => {
	it('is the entry id for a saved entry, whatever the title', () => {
		expect(editorTarget('abc', 'Topic')).toBe('entry:abc');
	});
	it('differs between new entries with different pre-filled titles', () => {
		expect(editorTarget(null, '')).not.toBe(editorTarget(null, 'Topic 1'));
		expect(editorTarget(null, 'Topic 1')).toBe(editorTarget(null, 'Topic 1'));
	});
});

describe('canGotoAfterFirstSave', () => {
	it('only while alive and still on the new-entry route', () => {
		expect(canGotoAfterFirstSave({ destroyed: false, routeEntryId: null })).toBe(true);
		expect(canGotoAfterFirstSave({ destroyed: true, routeEntryId: null })).toBe(false);
		expect(canGotoAfterFirstSave({ destroyed: false, routeEntryId: 'e1' })).toBe(false);
	});
});

describe('navigationPlan', () => {
	it('lets a clean editor go and saves a dirty or saving one first', () => {
		expect(navigationPlan('saved')).toBe('proceed');
		expect(navigationPlan('idle')).toBe('proceed');
		expect(navigationPlan('dirty')).toBe('save-first');
		expect(navigationPlan('saving')).toBe('save-first');
		expect(navigationPlan('error')).toBe('save-first');
	});
});

describe('isEntryGone', () => {
	it('is true for a 404 only', () => {
		expect(isEntryGone(new ApiError(404, 'not found'))).toBe(true);
		expect(isEntryGone(new ApiError(500, 'x'))).toBe(false);
		expect(isEntryGone(new Error('x'))).toBe(false);
	});
});

describe('tooLongHint', () => {
	it('is empty under the review cap and a hint above it', () => {
		expect(tooLongHint(5000)).toBe('');
		expect(tooLongHint(5001)).toMatch(/shorten|review/i);
	});
});

