import { describe, expect, it } from 'vitest';
import type { Workspace } from '$lib/api/types';
import { confirmLabel, forgetWorkspace, labelMatches } from './workspaceDelete';

function fakeStorage(entries: Record<string, string> = {}): Storage {
	const data = new Map<string, string>(Object.entries(entries));
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

function dump(storage: Storage): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i)!;
		out[key] = storage.getItem(key)!;
	}
	return out;
}

function workspace(id: number, language: string, name = ''): Workspace {
	return { id, language, name, settings: {}, updatedAt: '2026-01-01T00:00:00Z' };
}

describe('confirmLabel', () => {
	it('is the language for the only unnamed workspace of a language', () => {
		const zh = workspace(1, 'zh');
		expect(confirmLabel([zh, workspace(2, 'ja')], zh)).toBe('Chinese');
	});

	it('is the name of a named workspace', () => {
		const work = workspace(2, 'ja', 'Work');
		expect(confirmLabel([workspace(1, 'ja'), work], work)).toBe('Work');
	});

	it('numbers repeated unnamed workspaces as the switcher does', () => {
		const a = workspace(1, 'ja');
		const b = workspace(2, 'ja');
		expect(confirmLabel([a, b], a)).toBe('Japanese');
		expect(confirmLabel([a, b], b)).toBe('Japanese 2');
	});
});

describe('labelMatches', () => {
	it('accepts the exact label with surrounding spaces', () => {
		expect(labelMatches('  Work ', 'Work')).toBe(true);
	});

	it('refuses anything else', () => {
		expect(labelMatches('work', 'Work')).toBe(false);
		expect(labelMatches('', 'Work')).toBe(false);
		expect(labelMatches('Wor', 'Work')).toBe(false);
	});
});

describe('forgetWorkspace outbox v2', () => {
	it('purges the deleted workspace from every user\'s v2 items only', () => {
		const item = (id: string, userId: number, ws: number) => ({
			userId,
			queuedAt: '2026-11-10T08:00:00.000Z',
			event: { id, workspaceId: ws, ts: 't', type: 'review', device: 'web', payload: {} }
		});
		const local = fakeStorage({
			'qinqin.study.pending.v2': JSON.stringify([item('a', 1, 7), item('b', 2, 7), item('c', 1, 3)])
		});
		forgetWorkspace(7, local, null);
		expect(JSON.parse(local.getItem('qinqin.study.pending.v2') ?? '[]')).toEqual([item('c', 1, 3)]);
	});
});

describe('forgetWorkspace', () => {
	it('removes what the browser keeps for one workspace and nothing else', () => {
		const local = fakeStorage({
			'qinqin.workspace': '7',
			'qinqin.token': 't',
			'qinqin.session.7.2026-11-13': '1',
			'qinqin.session.7.2026-11-14': '1',
			'qinqin.session.17.2026-11-14': '1',
			'qinqin.session.3.2026-11-14': '1',
			'qinqin.study.setup.1.7': '{"raw":{"version":1},"dirty":false}',
			'qinqin.study.setup.2.7': '{"raw":{"version":1},"dirty":true}',
			'qinqin.study.setup.1.17': '{"raw":{"version":1},"dirty":false}',
			'qinqin.study.setup.1.3': '{"raw":{"version":1},"dirty":false}',
			'qinqin.study.pending.v2': JSON.stringify([
				{ userId: 1, queuedAt: 't', event: { id: 'a', workspaceId: 7, ts: 't', type: 'review', device: 'web', payload: {} } },
				{ userId: 2, queuedAt: 't', event: { id: 'b', workspaceId: 3, ts: 't', type: 'review', device: 'web', payload: {} } }
			]),
			'qinqin.reader.prefs': '{}'
		});
		const session = fakeStorage({
			'qinqin.study.ineligible': JSON.stringify({ '7': ['vocab:1'], '3': ['tone:2'] }),
			'qinqin.study.session': '{}'
		});

		forgetWorkspace(7, local, session);

		expect(dump(local)).toEqual({
			'qinqin.workspace': '7',
			'qinqin.token': 't',
			'qinqin.session.17.2026-11-14': '1',
			'qinqin.session.3.2026-11-14': '1',
			'qinqin.study.setup.1.17': '{"raw":{"version":1},"dirty":false}',
			'qinqin.study.setup.1.3': '{"raw":{"version":1},"dirty":false}',
			'qinqin.study.pending.v2': JSON.stringify([
				{ userId: 2, queuedAt: 't', event: { id: 'b', workspaceId: 3, ts: 't', type: 'review', device: 'web', payload: {} } }
			]),
			'qinqin.reader.prefs': '{}'
		});
		expect(dump(session)).toEqual({
			'qinqin.study.ineligible': JSON.stringify({ '3': ['tone:2'] }),
			'qinqin.study.session': '{}'
		});
	});

	it('drops keys that only held the deleted workspace', () => {
		const local = fakeStorage({
			'qinqin.study.setup.1.7': '{}',
			'qinqin.study.pending.v2': JSON.stringify([
				{ userId: 1, queuedAt: 't', event: { id: 'a', workspaceId: 7, ts: 't', type: 'review', device: 'web', payload: {} } }
			])
		});
		const session = fakeStorage({ 'qinqin.study.ineligible': JSON.stringify({ '7': ['vocab:1'] }) });

		forgetWorkspace(7, local, session);

		expect(dump(local)).toEqual({});
		expect(dump(session)).toEqual({});
	});

	it('leaves corrupt values alone and never throws', () => {
		const local = fakeStorage({ 'qinqin.study.ineligible.x': '{', 'qinqin.study.pending.v2': 'nope' });
		expect(() => forgetWorkspace(7, local, null)).not.toThrow();
		expect(dump(local)).toEqual({ 'qinqin.study.ineligible.x': '{', 'qinqin.study.pending.v2': 'nope' });

		const throwing = {
			get length(): number {
				throw new Error('denied');
			}
		} as unknown as Storage;
		expect(() => forgetWorkspace(7, throwing, throwing)).not.toThrow();
		expect(() => forgetWorkspace(7, null, null)).not.toThrow();
	});
});
