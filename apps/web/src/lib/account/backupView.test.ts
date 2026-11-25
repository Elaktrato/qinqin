import { describe, expect, it } from 'vitest';
import {
	canApply, clearLocalAfterRestore, countsLine, errorText, formatBytes, needsDropAck, nextPollDelay, replaceSentence,
	restoreSentence, stageProblem, unresolvedLines, type ApplyForm, type Report
} from './backupView';

const zero = { workspaces: 0, events: 0, cards: 0, rows: 0, overlays: 0, sentences: 0, books: 0, bookmarks: 0, highlights: 0 };
const report = (o: Partial<Report> = {}): Report => ({
	backup: { username: 'alice', createdAt: '2026-11-15T12:00:00Z', appVersion: '0.3.0' },
	replaces: { ...zero, workspaces: 3, events: 9876, cards: 1 }, restores: { ...zero, workspaces: 2, books: 1 },
	unresolved: { entries: [], entryCount: 0, sentences: 0, droppedRows: 0 }, reidentifiedEvents: 0,
	blocking: [], warnings: [], bytes: 10, ...o
});
const form = (o: Partial<ApplyForm> = {}): ApplyForm => ({
	status: 'ready', report: report(), ackDrop: false, password: 'pw', hasTotp: false, code: '', typed: 'alice', username: 'alice', busy: false, ...o
});

describe('report sentences', () => {
	it('names what is replaced and what comes back', () => {
		expect(countsLine(report().replaces)).toBe('3 workspaces, 9,876 study events, 1 card');
		expect(replaceSentence(report())).toContain('replace everything you have now: 3 workspaces');
		expect(restoreSentence(report())).toBe('From the backup (made 2026-11-15): 2 workspaces, 1 book.');
		expect(countsLine(zero)).toBe('nothing');
	});
	it('lists unresolved words with what refers to them', () => {
		const r = report({ unresolved: { entries: [{ written: '水', language: 'zh', cards: 2, overlays: 1 }], entryCount: 3, sentences: 0, droppedRows: 3 } });
		expect(unresolvedLines(r)).toEqual(['水 (2 cards, 1 edit)', 'and 2 more']);
		expect(needsDropAck(r)).toBe(true);
		expect(needsDropAck(report())).toBe(false);
	});
	it('names the personal notes of an unresolved word', () => {
		const r = report({
			unresolved: {
				entries: [
					{ written: '马', language: 'zh', cards: 1, overlays: 0, notes: 1 },
					{ written: '牛', language: 'zh', cards: 0, overlays: 0, notes: 2 },
					// an older server sends no notes count: read as 0
					{ written: '羊', language: 'zh', cards: 1, overlays: 1 }
				],
				entryCount: 3,
				sentences: 0,
				droppedRows: 6
			}
		});
		expect(unresolvedLines(r)).toEqual(['马 (1 card, 1 note)', '牛 (2 notes)', '羊 (1 card, 1 edit)']);
	});
});

describe('canApply', () => {
	it('needs password, the typed username and, when listed, the drop acknowledgement and a code', () => {
		expect(canApply(form())).toBe(true);
		expect(canApply(form({ password: '' }))).toBe(false);
		expect(canApply(form({ typed: 'ali' }))).toBe(false);
		expect(canApply(form({ hasTotp: true }))).toBe(false);
		expect(canApply(form({ hasTotp: true, code: '123456' }))).toBe(true);
		const un = report({ unresolved: { entries: [], entryCount: 1, sentences: 0, droppedRows: 1 } });
		expect(canApply(form({ report: un }))).toBe(false);
		expect(canApply(form({ report: un, ackDrop: true }))).toBe(true);
	});
	it('is off while busy, not ready, or blocked', () => {
		expect(canApply(form({ busy: true }))).toBe(false);
		expect(canApply(form({ status: 'validating' }))).toBe(false);
		expect(canApply(form({ report: report({ blocking: ['The language ja is not set up on this server.'] }) }))).toBe(false);
	});
});

describe('messages and polling', () => {
	it('maps error codes to sentences and keeps a safe detail', () => {
		expect(errorText('wrong_password', 'x')).toBe('The password is wrong.');
		expect(errorText('mystery', 'fallback')).toBe('fallback');
		expect(stageProblem({ status: 'invalid', report: null, result: null, error: { code: 'backup_invalid', message: 'm', detail: 'The archive is encrypted.' } }))
			.toBe('This file is not a valid qinqin backup. The archive is encrypted.');
	});
	it('polls every second, then every five', () => {
		expect(nextPollDelay(0)).toBe(1000);
		expect(nextPollDelay(9)).toBe(1000);
		expect(nextPollDelay(10)).toBe(5000);
	});
	it('formats sizes', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(2048)).toBe('2 KiB');
		expect(formatBytes(5 * 1048576)).toBe('5.0 MiB');
	});
});

describe('clearLocalAfterRestore', () => {
	const item = (userId: number | null, id: string) => ({ userId, queuedAt: 't', event: { id, workspaceId: 7, ts: 't', type: 'review', device: 'web', payload: {} } });
	function store(entries: [string, string][]) {
		const m = new Map(entries);
		return { m, st: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } };
	}
	it('forgets the workspace and the restoring user\'s queued reviews and counts them', () => {
		const { m, st } = store([['qinqin.workspace', '7'], ['qinqin.study.pending.v2', JSON.stringify([item(1, 'a'), item(1, 'b')])], ['qinqin.study.session', '{}'], ['qinqin.token', 't']]);
		expect(clearLocalAfterRestore(st, 1)).toBe(2);
		expect([...m.keys()]).toEqual(['qinqin.token']);
	});
	// M1 (#198 review): a shared browser keeps another user's unsent reviews.
	it('keeps another user\'s queued reviews and counts only the dropped ones', () => {
		const { m, st } = store([['qinqin.study.pending.v2', JSON.stringify([item(1, 'a'), item(2, 'bob'), item(null, 'u'), item(1, 'c')])]]);
		expect(clearLocalAfterRestore(st, 1)).toBe(3);
		expect(JSON.parse(m.get('qinqin.study.pending.v2')!)).toEqual([item(2, 'bob')]);
	});
	it('drops nothing of the queue without a known user', () => {
		const { m, st } = store([['qinqin.study.pending.v2', JSON.stringify([item(2, 'bob')])]]);
		expect(clearLocalAfterRestore(st, null)).toBe(0);
		expect(JSON.parse(m.get('qinqin.study.pending.v2')!)).toEqual([item(2, 'bob')]);
	});
	it('survives broken storage content', () => {
		expect(clearLocalAfterRestore({ getItem: () => '{not json', setItem: () => {}, removeItem: () => { throw new Error('x'); } }, 1)).toBe(0);
	});
});

