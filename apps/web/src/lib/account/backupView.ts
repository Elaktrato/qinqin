// Pure logic of Settings -> Account -> Your data (export and restore).

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

const nf = new Intl.NumberFormat('en');

/** "3 workspaces, 9 876 reviews, ..." for the non-zero counts. */
export function countsLine(c: Counts): string {
	const parts: Array<[number, string, string]> = [
		[c.workspaces, 'workspace', 'workspaces'],
		[c.events, 'study event', 'study events'],
		[c.cards, 'card', 'cards'],
		[c.books, 'book', 'books'],
		[c.overlays, 'word edit', 'word edits'],
		[c.sentences, 'own sentence', 'own sentences']
	];
	const out = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${nf.format(n)} ${n === 1 ? one : many}`);
	return out.length ? out.join(', ') : 'nothing';
}

export function replaceSentence(r: Report): string {
	return `This will replace everything you have now: ${countsLine(r.replaces)}.`;
}

export function restoreSentence(r: Report): string {
	return `From the backup (made ${r.backup.createdAt.slice(0, 10)}): ${countsLine(r.restores)}.`;
}

/** The words the backup mentions that this server does not have. */
export function unresolvedLines(r: Report): string[] {
	const lines = r.unresolved.entries.map((e) => {
		const bits = [e.cards ? `${e.cards} card${e.cards === 1 ? '' : 's'}` : '', e.overlays ? `${e.overlays} edit${e.overlays === 1 ? '' : 's'}` : ''].filter(Boolean);
		return bits.length ? `${e.written || '(unknown word)'} (${bits.join(', ')})` : e.written || '(unknown word)';
	});
	const more = r.unresolved.entryCount - r.unresolved.entries.length;
	if (more > 0) lines.push(`and ${nf.format(more)} more`);
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

const ERRORS: Record<string, string> = {
	backup_invalid: 'This file is not a valid qinqin backup.',
	backup_too_large: 'This backup is larger than the limits allow.',
	backup_version_unsupported: 'This backup has a format this server cannot read.',
	wrong_password: 'The password is wrong.',
	current_password_required: 'Enter your password.',
	code_invalid: 'That code is not right.',
	confirm_mismatch: 'Type your username exactly.',
	unresolved_entries: 'Confirm that the missing words are dropped.',
	restore_running: 'A restore is already running.',
	export_running: 'An export is already running. Try again in a moment.',
	stage_not_ready: 'This upload is not ready to be restored.',
	rate_limited: 'Too many attempts. Try again later.',
	not_found: 'This upload has expired. Choose the file again.'
};

export function errorText(code: string | undefined, fallback: string): string {
	return (code && ERRORS[code]) || fallback;
}

/** Sentence for a stage that ended badly; the detail never holds file content. */
export function stageProblem(v: StageView): string {
	if (!v.error) return '';
	const base = errorText(v.error.code, v.error.message);
	return v.error.detail ? `${base} ${v.error.detail}` : base;
}

/** Polling: every second at first, then every five. */
export function nextPollDelay(attempt: number): number {
	return attempt < 10 ? 1000 : 5000;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KiB`;
	return `${(n / 1048576).toFixed(1)} MiB`;
}

export const LOCAL_KEYS_AFTER_RESTORE = ['qinqin.workspace', 'qinqin.study.session', 'qinqin.study.pending'] as const;

/**
 * After a restore the workspace ids are new: forget the selected workspace,
 * the running session and the queued reviews of the old ids. Returns how
 * many queued reviews were dropped (so the page can say so).
 */
export function clearLocalAfterRestore(storage: Pick<Storage, 'getItem' | 'removeItem'>): number {
	let dropped = 0;
	try {
		const raw = storage.getItem('qinqin.study.pending');
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
