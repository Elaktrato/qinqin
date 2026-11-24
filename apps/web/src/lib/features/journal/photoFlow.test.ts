import { describe, expect, it } from 'vitest';
import {
	KEEPALIVE_MS,
	keepaliveTarget,
	offlineButtonLabel,
	aiReadable,
	defaultEngine,
	noVisionText,
	needsDownscale,
	photoReducer,
	photoToDelete,
	scaledSize,
	type PhotoEvent,
	type PhotoState
} from './photoFlow';
import type { AiErrorView } from './aiErrors';

const view: AiErrorView = { text: 'x', settingsLink: false, offlineInstead: true, poll: false };
const MIB = 1024 * 1024;

function run(start: PhotoState, events: PhotoEvent[]): PhotoState {
	return events.reduce(photoReducer, start);
}

describe('photoReducer', () => {
	it('walks the happy path', () => {
		let s: PhotoState = { step: 'pick' };
		s = photoReducer(s, { type: 'picked' });
		expect(s).toEqual({ step: 'uploading' });
		s = photoReducer(s, { type: 'uploaded', photoId: 'p1' });
		expect(s).toEqual({ step: 'choose', photoId: 'p1' });
		s = photoReducer(s, { type: 'read', engine: 'ai' });
		expect(s).toEqual({ step: 'reading', photoId: 'p1', engine: 'ai' });
		s = photoReducer(s, { type: 'readDone', text: 'abc', unreadable: false });
		expect(s).toEqual({ step: 'draft', photoId: 'p1', text: 'abc', engine: 'ai', unreadable: false });
		s = photoReducer(s, { type: 'edit', text: 'abcd' });
		expect(s).toMatchObject({ step: 'draft', text: 'abcd', unreadable: false });
		expect(photoReducer(s, { type: 'saved' })).toEqual({ step: 'done' });
	});

	it('keeps the photo id when an AI read fails so offline can retry', () => {
		const failed = run({ step: 'reading', photoId: 'p1', engine: 'ai' }, [{ type: 'failed', view }]);
		expect(failed).toEqual({ step: 'error', photoId: 'p1', view });
		expect(photoReducer(failed, { type: 'read', engine: 'offline' })).toEqual({
			step: 'reading',
			photoId: 'p1',
			engine: 'offline'
		});
	});

	it('has no photo id when the upload fails, and lets the learner pick again', () => {
		const failed = run({ step: 'pick' }, [{ type: 'picked' }, { type: 'failed', view }]);
		expect(failed).toEqual({ step: 'error', photoId: null, view });
		expect(photoReducer(failed, { type: 'picked' })).toEqual({ step: 'uploading' });
	});

	it('ignores events that do not fit the state', () => {
		const s: PhotoState = { step: 'pick' };
		expect(photoReducer(s, { type: 'saved' })).toBe(s);
		expect(photoReducer(s, { type: 'readDone', text: 'x', unreadable: false })).toBe(s);
		const choose: PhotoState = { step: 'choose', photoId: 'p' };
		expect(photoReducer(choose, { type: 'saved' })).toBe(choose);
	});

	it('marks an empty page as unreadable draft', () => {
		const s = run({ step: 'reading', photoId: 'p', engine: 'offline' }, [
			{ type: 'readDone', text: '', unreadable: true }
		]);
		expect(s).toMatchObject({ step: 'draft', unreadable: true, text: '' });
	});
});

describe('photoToDelete', () => {
	const draft: PhotoState = { step: 'draft', photoId: 'p', text: 't', engine: 'ai', unreadable: false };
	const choose: PhotoState = { step: 'choose', photoId: 'p' };
	const err: PhotoState = { step: 'error', photoId: 'p', view };
	const done: PhotoState = { step: 'done' };

	it('returns the id when saved or discarded ends the draft', () => {
		expect(photoToDelete(draft, photoReducer(draft, { type: 'saved' }))).toBe('p');
		for (const from of [draft, choose, err]) {
			expect(photoToDelete(from, photoReducer(from, { type: 'discarded' }))).toBe('p');
		}
	});

	it('is null for every other transition', () => {
		expect(photoToDelete(choose, { step: 'reading', photoId: 'p', engine: 'ai' })).toBeNull();
		expect(photoToDelete(draft, photoReducer(draft, { type: 'edit', text: 'z' }))).toBeNull();
		expect(photoToDelete({ step: 'pick' }, { step: 'uploading' })).toBeNull();
		expect(photoToDelete({ step: 'error', photoId: null, view }, done)).toBeNull();
		expect(photoToDelete(done, done)).toBeNull();
	});
});

describe('needsDownscale', () => {
	it('is true over 10 MiB or for types the server does not take', () => {
		expect(needsDownscale({ size: 11 * MIB, type: 'image/jpeg' })).toBe(true);
		expect(needsDownscale({ size: MIB, type: 'image/heic' })).toBe(true);
		expect(needsDownscale({ size: MIB, type: '' })).toBe(true);
	});
	it('is false for a small JPEG, PNG or WebP', () => {
		expect(needsDownscale({ size: 2 * MIB, type: 'image/png' })).toBe(false);
		expect(needsDownscale({ size: 10 * MIB, type: 'image/webp' })).toBe(false);
	});
});

describe('aiReadable', () => {
	const st = (over: Record<string, unknown>) => ({ available: true, active: { vision: true, model: 'm' }, ...over }) as never;
	it('needs a working AI that can see photos', () => {
		expect(aiReadable(st({}))).toBe(true);
		expect(aiReadable(st({ active: { vision: false, model: 'deepseek-v4-pro' } }))).toBe(false);
		expect(aiReadable(st({ available: false }))).toBe(false);
		expect(aiReadable(st({ active: null }))).toBe(false);
		expect(aiReadable(null)).toBe(false);
	});
	it('says which model cannot read photos', () => {
		expect(noVisionText(st({ active: { vision: false, model: 'deepseek-v4-pro' } }))).toBe("deepseek-v4-pro can't read photos.");
		expect(noVisionText(st({}))).toBeNull();
		expect(noVisionText(st({ available: false, active: { vision: false, model: 'x' } }))).toBeNull();
		expect(noVisionText(null)).toBeNull();
	});
});

describe('defaultEngine and keepalive', () => {
	it('prefers AI only when available', () => {
		expect(defaultEngine(true)).toBe('ai');
		expect(defaultEngine(false)).toBe('offline');
	});
	it('pings every 10 minutes', () => expect(KEEPALIVE_MS).toBe(600000));
});

describe('scaledSize', () => {
	it('caps the long edge at 3000 and keeps the ratio', () => {
		expect(scaledSize(6000, 4000)).toEqual({ width: 3000, height: 2000 });
		expect(scaledSize(3000, 9000)).toEqual({ width: 1000, height: 3000 });
	});
	it('never enlarges', () => expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 }));
});

describe('keepaliveTarget', () => {
	const draft = (text: string): PhotoState => ({
		step: 'draft',
		photoId: 'p1',
		text,
		engine: 'ai',
		unreadable: false
	});

	it('is the same value across edits, so the timer is not reset per keystroke', () => {
		expect(keepaliveTarget(draft('a'))).toBe('p1');
		expect(keepaliveTarget(draft('ab'))).toBe(keepaliveTarget(draft('a')));
	});

	it('is null without a photo, when done, and after the photo expired', () => {
		expect(keepaliveTarget({ step: 'pick' })).toBeNull();
		expect(keepaliveTarget({ step: 'done' })).toBeNull();
		expect(keepaliveTarget({ step: 'error', photoId: null, view })).toBeNull();
		expect(keepaliveTarget({ ...(draft('a') as object), expired: true } as PhotoState)).toBeNull();
	});
});

describe('photoExpired', () => {
	it('keeps the text of a draft and only marks the photo expired', () => {
		const s = photoReducer(
			{ step: 'draft', photoId: 'p1', text: 'mine', engine: 'ai', unreadable: false },
			{ type: 'photoExpired', view }
		);
		expect(s).toMatchObject({ step: 'draft', text: 'mine', expired: true });
	});

	it('before a draft it drops back to picking again', () => {
		const s = photoReducer({ step: 'choose', photoId: 'p1' }, { type: 'photoExpired', view });
		expect(s).toEqual({ step: 'error', photoId: null, view });
	});

	it('still deletes the photo id on save of an expired draft (a 404 is fine)', () => {
		const expired = photoReducer(
			{ step: 'draft', photoId: 'p1', text: 'x', engine: 'ai', unreadable: false },
			{ type: 'photoExpired', view }
		);
		expect(photoToDelete(expired, photoReducer(expired, { type: 'saved' }))).toBe('p1');
	});
});

describe('offlineButtonLabel', () => {
	it('says "instead" only after an AI read failed', () => {
		expect(offlineButtonLabel({ failedEngine: 'ai', offlineInstead: true })).toBe('Read offline instead');
		expect(offlineButtonLabel({ failedEngine: 'offline', offlineInstead: true })).toBe('Read offline');
		expect(offlineButtonLabel({ failedEngine: null, offlineInstead: false })).toBe('Read offline');
		expect(offlineButtonLabel({ failedEngine: 'ai', offlineInstead: false })).toBe('Read offline');
	});
});
