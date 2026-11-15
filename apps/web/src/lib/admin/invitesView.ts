import type { InviteDto } from '$lib/api/adminSettings';

export const EXPIRY_CHOICES: ReadonlyArray<{ label: string; days: number | null }> = [
	{ label: '1 day', days: 1 },
	{ label: '7 days', days: 7 },
	{ label: '30 days', days: 30 },
	{ label: '90 days', days: 90 },
	{ label: 'No expiry', days: null }
];

export const DEFAULT_EXPIRY_DAYS = 7;

/** The request body of the create form; uses are clamped to 1-100 like the server. */
export function invitePayload(
	maxUses: number,
	expiresInDays: number | null,
	note: string
): { maxUses: number; expiresInDays: number | null; note: string } {
	const uses = Number.isFinite(maxUses) ? Math.min(100, Math.max(1, Math.trunc(maxUses))) : 1;
	return { maxUses: uses, expiresInDays, note: note.trim() };
}

const STATE_LABELS: Record<InviteDto['state'], string> = {
	active: 'Active',
	expired: 'Expired',
	used_up: 'Used up',
	revoked: 'Revoked',
	inactive: 'Inactive while registration is closed'
};

export function stateLabel(state: InviteDto['state']): string {
	return STATE_LABELS[state] ?? state;
}

export interface InviteRow {
	id: number;
	note: string;
	state: string;
	uses: string;
	expires: string;
	canRevoke: boolean;
}

/** Rows of the invite list: "2 / 5" uses, an expiry date or "Never", Revoke while not revoked. */
export function inviteRows(invites: readonly InviteDto[]): InviteRow[] {
	return invites.map((i) => ({
		id: i.id,
		note: i.note || 'No note',
		state: stateLabel(i.state),
		uses: `${i.uses} / ${i.maxUses}`,
		expires: i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : 'Never',
		canRevoke: i.state !== 'revoked'
	}));
}

export const CLOSED_NOTE = 'Invites do not work while registration is closed. Change the mode under Security.';

/** The full link an admin hands over: origin plus the server's path (the token stays in the fragment). */
export function inviteLink(origin: string, path: string): string {
	return origin + path;
}
