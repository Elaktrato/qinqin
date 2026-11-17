// Pure logic of Settings -> Admin -> Backup.
import { t, type MessageKey } from '$lib/i18n';

function part(id: string, label: MessageKey, hint: MessageKey): { id: string; readonly label: string; readonly hint: string } {
	return {
		id,
		get label() {
			return t(label);
		},
		get hint() {
			return t(hint);
		}
	};
}

export const PARTS: ReadonlyArray<{ id: string; readonly label: string; readonly hint: string }> = [
	part('db', 'admin.backup.part.db', 'admin.backup.part.dbHint'),
	part('books', 'admin.backup.part.books', 'admin.backup.part.booksHint'),
	part('packs', 'admin.backup.part.packs', 'admin.backup.part.packsHint'),
	part('audio', 'admin.backup.part.audio', 'admin.backup.part.audioHint')
];

/** Which parts the request names: all four are the default. */
export function includeBody(selected: ReadonlySet<string>): string[] {
	return PARTS.map((p) => p.id).filter((id) => selected.has(id));
}

export function canCreate(selected: ReadonlySet<string>, password: string, busy: boolean, needsCode = false, code = ''): boolean {
	return !busy && selected.size > 0 && password !== '' && (!needsCode || code.trim() !== '');
}

const TEXT: Record<string, MessageKey> = {
	insufficient_storage: 'admin.backup.error.insufficientStorage',
	backup_running: 'admin.backup.error.running',
	wrong_password: 'admin.reauth.error.wrongPassword',
	password_required: 'admin.reauth.error.passwordRequired',
	rate_limited: 'admin.backup.error.rateLimited',
	code_invalid: 'admin.backup.error.codeInvalid',
	forbidden: 'admin.backup.error.forbidden'
};

export function backupError(code: string | undefined, fallback: string): string {
	return code && Object.hasOwn(TEXT, code) ? t(TEXT[code]) : fallback;
}

/** The restore steps, in order. */
export function restoreSteps(): string[] {
	return [
		t('admin.backup.restore.stop'),
		t('admin.backup.restore.empty'),
		t('admin.backup.restore.extract', { file: '<file>' }),
		t('admin.backup.restore.start')
	];
}

export function securityNote(): string {
	return t('admin.backup.securityNote');
}
