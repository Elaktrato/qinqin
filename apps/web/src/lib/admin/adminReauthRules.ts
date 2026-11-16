// When a PATCH of an administrator route needs the acting administrator's
// re-authentication. Mirrors server/internal/api/admin_reauth_rules.go;
// both are pinned by docs/contracts/auth/admin-reauth.json. (Granting admin,
// creating an administrator, deleting a user, reset links, the two-step
// reset, the mail settings and the server backup always need it.)
import type { AuthSettings } from '$lib/api/adminSettings';

export interface UserPatchChange {
	admin?: boolean;
	disabled?: boolean;
	/** Present (a string or null): the address is set or removed. */
	email?: string | null;
	mustChangePassword?: boolean;
}

export function userPatchNeedsReauth(targetAdmin: boolean, self: boolean, p: UserPatchChange): boolean {
	if (p.admin === true) return true;
	if ('email' in p) return true;
	return targetAdmin && !self && (p.admin === false || p.disabled === true);
}

export type SettingsPatch = Partial<Pick<AuthSettings, 'registration' | 'emailPolicy' | 'mfaEnforced' | 'emailCodeLogin'>> & {
	signOutOthers?: boolean;
};

const REGISTRATION: Record<string, number> = { closed: 0, invite: 1, open: 2 };
const EMAIL_POLICY: Record<string, number> = { off: 0, optional: 1, required: 2 };

function moved(rank: Record<string, number>, from: string, to: string | undefined): number {
	if (to === undefined || !(from in rank) || !(to in rank)) return 0;
	return rank[to] - rank[from];
}

export function settingsPatchNeedsReauth(
	cur: Pick<AuthSettings, 'registration' | 'emailPolicy' | 'mfaEnforced' | 'emailCodeLogin'>,
	p: SettingsPatch
): boolean {
	return (
		p.signOutOthers === true ||
		(p.mfaEnforced === false && cur.mfaEnforced) ||
		(p.emailCodeLogin === true && !cur.emailCodeLogin) ||
		moved(REGISTRATION, cur.registration, p.registration) > 0 ||
		moved(EMAIL_POLICY, cur.emailPolicy, p.emailPolicy) < 0
	);
}
