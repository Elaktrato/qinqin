import type { InviteDto } from '$lib/api/adminSettings';
import { t, type MessageKey } from '$lib/i18n';
import { formatDate } from '$lib/i18n/format';

function choice(days: number | null): { readonly label: string; days: number | null } {
	return {
		days,
		get label() {
			return days === null ? t('admin.invites.expiry.none') : t('admin.invites.expiry.days', { count: days });
		}
	};
}

export const EXPIRY_CHOICES: ReadonlyArray<{ readonly label: string; days: number | null }> = [
	choice(1),
	choice(7),
	choice(30),
	choice(90),
	choice(null)
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

const STATE_LABELS: Record<InviteDto['state'], MessageKey> = {
	active: 'admin.invites.state.active',
	expired: 'admin.invites.state.expired',
	used_up: 'admin.invites.state.usedUp',
	revoked: 'admin.invites.state.revoked',
	inactive: 'admin.invites.state.inactive'
};

export function stateLabel(state: InviteDto['state']): string {
	return Object.hasOwn(STATE_LABELS, state) ? t(STATE_LABELS[state]) : state;
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
		note: i.note || t('admin.invites.noNote'),
		state: stateLabel(i.state),
		uses: t('admin.invites.uses', { uses: i.uses, max: i.maxUses }),
		expires: i.expiresAt ? formatDate(i.expiresAt) : t('admin.invites.never'),
		canRevoke: i.state !== 'revoked'
	}));
}

export function closedNote(): string {
	return t('admin.invites.closedNote');
}

/** The full link an admin hands over: origin plus the server's path (the token stays in the fragment). */
export function inviteLink(origin: string, path: string): string {
	return origin + path;
}
