// Pure logic of Settings -> Account -> Your data (export and restore).

import { API_ERROR_KEYS, apiErrorText } from '$lib/api/apiErrors';
import { t, type MessageKey } from '$lib/i18n';
import { formatNumber } from '$lib/i18n/format';
import { PENDING_REVIEWS_KEY } from '$lib/study/events';

export interface Counts {
	workspaces: number;
	events: number;
	cards: number;
	pluginData: number;
	overlays: number;
	sentences: number;
	books: number;
	bookmarks: number;
	highlights: number;
}

export interface UnresolvedEntry {
	written: string;
	language: string;
	cards: number;
	overlays: number;
	/** Personal notes on the word; missing from servers older than notes (read as 0). */
	notes?: number;
}

export interface Report {
	backup: { username: string; createdAt: string; appVersion: string };
	replaces: Counts;
	restores: Counts;
	unresolved: { entries: UnresolvedEntry[]; entryCount: number; sentences: number; droppedRows: number };
	pluginsNotInstalled: string[];
	reidentifiedEvents: number;
	blocking: string[];
	warnings: string[];
	bytes: number;
}

export type StageStatus = 'validating' | 'ready' | 'invalid' | 'running' | 'done' | 'failed';

export interface StageView {
	status: StageStatus;
	report: Report | null;
	error: { code: string; message: string; detail?: string } | null;
	result: { restored: Counts; droppedRows: number; revokedSessions: number } | null;
}

/** "3 workspaces, 9 876 reviews, ..." for the non-zero counts. */
export function countsLine(c: Counts): string {
	const parts: Array<[number, MessageKey]> = [
		[c.workspaces, 'account.backup.countWorkspaces'],
		[c.events, 'account.backup.countEvents'],
		[c.cards, 'account.backup.countCards'],
		[c.books, 'account.backup.countBooks'],
		[c.overlays, 'account.backup.countEdits'],
		[c.sentences, 'account.backup.countSentences']
	];
	const out = parts.filter(([n]) => n > 0).map(([n, key]) => t(key, { count: n }));
	return out.length ? out.join(', ') : t('account.backup.nothing');
}

export function replaceSentence(r: Report): string {
	return t('account.backup.replaces', { counts: countsLine(r.replaces) });
}

export function restoreSentence(r: Report): string {
	return t('account.backup.restores', { day: r.backup.createdAt.slice(0, 10), counts: countsLine(r.restores) });
}

/** The words the backup mentions that this server does not have. */
export function unresolvedLines(r: Report): string[] {
	const lines = r.unresolved.entries.map((e) => {
		const notes = e.notes ?? 0;
		const bits = [
			e.cards ? t('account.backup.entryCards', { count: e.cards }) : '',
			e.overlays ? t('account.backup.entryEdits', { count: e.overlays }) : '',
			notes ? t('account.backup.entryNotes', { count: notes }) : ''
		].filter(Boolean);
		const word = e.written || t('account.backup.unknownWord');
		return bits.length ? `${word} (${bits.join(', ')})` : word;
	});
	const more = r.unresolved.entryCount - r.unresolved.entries.length;
	if (more > 0) lines.push(t('account.backup.more', { count: formatNumber(more) }));
	return lines;
}

export function needsDropAck(r: Report): boolean {
	return r.unresolved.entryCount > 0 || r.unresolved.sentences > 0;
}

export interface ApplyForm {
	status: StageStatus;
	report: Report | null;
	ackDrop: boolean;
	password: string;
	hasTotp: boolean;
	code: string;
	typed: string;
	username: string;
	busy: boolean;
}

/** The Restore button is enabled only when everything the server asks for is filled in. */
export function canApply(f: ApplyForm): boolean {
	if (f.busy || f.status !== 'ready' || !f.report || f.report.blocking.length > 0) return false;
	if (needsDropAck(f.report) && !f.ackDrop) return false;
	if (f.password === '' || f.typed !== f.username) return false;
	if (f.hasTotp && f.code.trim() === '') return false;
	return true;
}

const ERRORS: Record<string, MessageKey> = {
	backup_invalid: 'account.backup.error.backupInvalid',
	backup_too_large: 'account.backup.error.backupTooLarge',
	backup_version_unsupported: 'account.backup.error.backupVersionUnsupported',
	wrong_password: 'account.backup.error.wrongPassword',
	current_password_required: 'account.backup.error.currentPasswordRequired',
	code_invalid: 'account.backup.error.codeInvalid',
	confirm_mismatch: 'account.backup.error.confirmMismatch',
	unresolved_entries: 'account.backup.error.unresolvedEntries',
	restore_running: 'account.backup.error.restoreRunning',
	export_running: 'account.backup.error.exportRunning',
	stage_not_ready: 'account.backup.error.stageNotReady',
	rate_limited: 'account.backup.error.rateLimited',
	not_found: 'account.backup.error.notFound'
};

/** The backup screens' sentence for an error code, else the API error text of a known code, else `fallback`. */
export function errorText(code: string | undefined, fallback: string): string {
	if (code && Object.hasOwn(ERRORS, code)) return t(ERRORS[code]);
	if (code && Object.hasOwn(API_ERROR_KEYS, code)) return t(API_ERROR_KEYS[code]);
	return fallback;
}

/** Sentence for a stage that ended badly; the detail never holds file content. */
export function stageProblem(v: StageView): string {
	if (!v.error) return '';
	const base = errorText(v.error.code, apiErrorText(v.error.code));
	return v.error.detail ? `${base} ${v.error.detail}` : base;
}

/** Polling: every second at first, then every five. */
export function nextPollDelay(attempt: number): number {
	return attempt < 10 ? 1000 : 5000;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return t('account.backup.sizeKib', { n: formatNumber(n / 1024, { maximumFractionDigits: 0 }) });
	return t('account.backup.sizeMib', { n: formatNumber(n / 1048576, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}

export const LOCAL_KEYS_AFTER_RESTORE = ['qinqin.workspace', 'qinqin.study.session', PENDING_REVIEWS_KEY] as const;

/**
 * After a restore the workspace ids are new: forget the selected workspace,
 * the running session and the queued reviews of the old ids. Returns how
 * many queued reviews were dropped (so the page can say so).
 */
export function clearLocalAfterRestore(storage: Pick<Storage, 'getItem' | 'removeItem'>): number {
	let dropped = 0;
	try {
		const raw = storage.getItem(PENDING_REVIEWS_KEY);
		if (raw) {
			const v = JSON.parse(raw) as unknown;
			dropped = Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0;
		}
	} catch {
		dropped = 0;
	}
	for (const k of LOCAL_KEYS_AFTER_RESTORE) {
		try {
			storage.removeItem(k);
		} catch {
			// storage unusable: nothing to clear
		}
	}
	return dropped;
}
