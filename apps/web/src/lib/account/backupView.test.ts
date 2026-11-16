import { describe, expect, it } from 'vitest';
import {
	canApply, clearLocalAfterRestore, countsLine, errorText, formatBytes, needsDropAck, nextPollDelay, replaceSentence,
	restoreSentence, stageProblem, unresolvedLines, type ApplyForm, type Report
} from './backupView';

const zero = { workspaces: 0, events: 0, cards: 0, pluginData: 0, overlays: 0, sentences: 0, books: 0, bookmarks: 0, highlights: 0 };
const report = (o: Partial<Report> = {}): Report => ({
	backup: { username: 'alice', createdAt: '2026-11-15T12:00:00Z', appVersion: '0.3.0' },
	replaces: { ...zero, workspaces: 3, events: 9876, cards: 1 }, restores: { ...zero, workspaces: 2, books: 1 },
	unresolved: { entries: [], entryCount: 0, sentences: 0, droppedRows: 0 }, pluginsNotInstalled: [], reidentifiedEvents: 0,
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
	it('forgets the workspace and queued reviews and counts the reviews', () => {
		const m = new Map([['qinqin.workspace', '7'], ['qinqin.study.pending', '[{"a":1},{"a":2}]'], ['qinqin.study.session', '{}'], ['qinqin.token', 't']]);
		const st = { getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => void m.delete(k) };
		expect(clearLocalAfterRestore(st)).toBe(2);
		expect([...m.keys()]).toEqual(['qinqin.token']);
	});
	it('survives broken storage content', () => {
		expect(clearLocalAfterRestore({ getItem: () => '{not json', removeItem: () => { throw new Error('x'); } })).toBe(0);
	});
});
