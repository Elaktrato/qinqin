import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/auth/admin-reauth.json';
import { settingsPatchNeedsReauth, userPatchNeedsReauth, type SettingsPatch, type UserPatchChange } from './adminReauthRules';
import type { AuthSettings } from '$lib/api/adminSettings';

// docs/contracts/auth/admin-reauth.json: the server enforces the same rule
// (server/internal/api/admin_reauth_rules.go), so the web asks exactly when needed.
describe('admin re-authentication rules (contract)', () => {
	it.each(fixture.userPatch.map((c) => [c.name, c] as const))('userPatch: %s', (_, c) => {
		expect(userPatchNeedsReauth(c.target.admin, c.self, c.patch as UserPatchChange)).toBe(c.reauth);
	});
	it.each(fixture.authSettings.map((c) => [c.name, c] as const))('authSettings: %s', (_, c) => {
		expect(settingsPatchNeedsReauth(c.current as Pick<AuthSettings, 'registration' | 'emailPolicy' | 'mfaEnforced' | 'emailCodeLogin'>, c.patch as SettingsPatch)).toBe(c.reauth);
	});
});
