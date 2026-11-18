import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ReauthFields from './ReauthFields.svelte';

afterEach(cleanup);

describe('the administrator re-authentication fields (#106)', () => {
	it('is a Field underline with the browser password autofill', () => {
		render(ReauthFields, { needsCode: false });
		const password = screen.getByLabelText('Your own password');
		expect(password.closest('.field')).not.toBeNull();
		expect(password.getAttribute('autocomplete')).toBe('current-password');
	});

	it('shows the authenticator code only when the account has one', () => {
		render(ReauthFields, { needsCode: false });
		expect(screen.queryByLabelText('Authenticator or recovery code (yours)')).toBeNull();
		cleanup();
		render(ReauthFields, { needsCode: true });
		const code = screen.getByLabelText('Authenticator or recovery code (yours)');
		expect(code.closest('.field')).not.toBeNull();
		expect(code.getAttribute('autocomplete')).toBe('one-time-code');
	});
});
