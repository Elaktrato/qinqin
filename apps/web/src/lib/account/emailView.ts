import type { AuthOptions } from '$lib/api/account';

export interface EmailSection {
	/** Show the email field at all (policy off: hidden, nothing personal is collected). */
	visible: boolean;
	/** The person may remove their address (not under required). */
	canClear: boolean;
	label: string;
	/** Required and missing: show the soft banner in Settings and on Home. */
	banner: boolean;
}

export const EMAIL_BANNER_TEXT =
	'This server asks everyone to add an email address. Add yours in Settings, Account.';

/**
 * emailSection decides what the profile shows for the instance's email
 * policy and the user's current address. Existing users without an address
 * are never blocked under `required`: they only get the banner.
 */
export function emailSection(policy: AuthOptions['emailPolicy'] | null, email: string | null): EmailSection {
	if (policy === null || policy === 'off') return { visible: false, canClear: false, label: '', banner: false };
	return {
		visible: true,
		canClear: policy === 'optional' && email !== null,
		label: policy === 'required' ? 'Email' : 'Email (optional)',
		banner: policy === 'required' && !email
	};
}
