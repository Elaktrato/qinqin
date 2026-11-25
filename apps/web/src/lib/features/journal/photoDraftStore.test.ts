import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from './photoDraftStore';

function memoryStorage(): Storage {
	const m = new Map<string, string>();
	return {
		getItem: (k) => m.get(k) ?? null,
		setItem: (k, v) => void m.set(k, v),
		removeItem: (k) => void m.delete(k),
		clear: () => m.clear(),
		key: () => null,
		length: 0
	} as Storage;
}

afterEach(() => vi.unstubAllGlobals());

describe('photoDraftStore', () => {
	it('round-trips a draft for its workspace only', () => {
		vi.stubGlobal('sessionStorage', memoryStorage());
		saveDraft({ photoId: 'p1', workspaceId: 3, text: 'hi', engine: 'ai' });
		expect(loadDraft(3)).toEqual({ photoId: 'p1', text: 'hi', engine: 'ai' });
		expect(loadDraft(4)).toBeNull();
		clearDraft();
		expect(loadDraft(3)).toBeNull();
	});

	it('returns null for garbage', () => {
		const s = memoryStorage();
		vi.stubGlobal('sessionStorage', s);
		s.setItem('qinqin.journal.photoDraft', '{not json');
		expect(loadDraft(1)).toBeNull();
		s.setItem('qinqin.journal.photoDraft', JSON.stringify({ photoId: 5, workspaceId: 1 }));
		expect(loadDraft(1)).toBeNull();
	});

	it('does not throw when sessionStorage throws', () => {
		const boom = () => {
			throw new Error('blocked');
		};
		vi.stubGlobal('sessionStorage', { getItem: boom, setItem: boom, removeItem: boom });
		expect(() => saveDraft({ photoId: 'p', workspaceId: 1, text: '', engine: 'ai' })).not.toThrow();
		expect(loadDraft(1)).toBeNull();
		expect(() => clearDraft()).not.toThrow();
	});
});
