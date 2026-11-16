// Pure logic of Settings -> Admin -> Backup.

export const PARTS: ReadonlyArray<{ id: string; label: string; hint: string }> = [
	{ id: 'db', label: 'Database', hint: 'Accounts, study history, settings (a consistent snapshot).' },
	{ id: 'books', label: 'Books', hint: 'The library texts of all users.' },
	{ id: 'packs', label: 'Packs', hint: 'Installed dictionary and data packs.' },
	{ id: 'audio', label: 'Audio', hint: 'Installed audio clips.' }
];

/** Which parts the request names: all four are the default. */
export function includeBody(selected: ReadonlySet<string>): string[] {
	return PARTS.map((p) => p.id).filter((id) => selected.has(id));
}

export function canCreate(selected: ReadonlySet<string>, password: string, busy: boolean): boolean {
	return !busy && selected.size > 0 && password !== '';
}

const TEXT: Record<string, string> = {
	insufficient_storage: 'There is not enough free space on the data volume for a snapshot of the database. Free some space and try again.',
	backup_running: 'A backup is already running.',
	wrong_password: 'Your password is wrong.',
	password_required: 'Enter your own password.',
	rate_limited: 'Server backups are limited to one per minute. Try again shortly.',
	forbidden: 'Only administrators can create server backups.'
};

export function backupError(code: string | undefined, fallback: string): string {
	return (code && TEXT[code]) || fallback;
}

export const RESTORE_STEPS: readonly string[] = [
	'Stop the container.',
	'Empty the data volume.',
	'Extract the archive into it: tar xzf <file> -C /data.',
	'Start the same QINQIN_SECRET and the same or a newer image.'
];

export const SECURITY_NOTE =
	'The archive holds password hashes, hashed session tokens and secrets sealed with QINQIN_SECRET. Store it like the secret itself.';
