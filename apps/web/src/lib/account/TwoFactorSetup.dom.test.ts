import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import { ApiError } from '$lib/api/client';

const { me } = vi.hoisted(() => ({ me: { current: null as unknown } }));
vi.mock('$lib/auth', async () => {
	const { writable } = await import('svelte/store');
	const user = writable<unknown>({ id: 1, username: 'bobby', email: null, emailVerified: false });
	me.current = user;
	return { user, loadMe: vi.fn(async () => undefined) };
});
vi.mock('$lib/api/mfa', () => ({
	totpSetup: vi.fn(),
	totpConfirm: vi.fn(),
	setEmailMethod: vi.fn(),
	verifyEmailCode: vi.fn(),
	confirmEmailMethod: vi.fn(),
	resendEmailCode: vi.fn()
}));
vi.mock('$lib/api/account', () => ({ putEmail: vi.fn() }));

import { putEmail, type AuthOptions } from '$lib/api/account';
import { confirmEmailMethod, setEmailMethod, totpConfirm, totpSetup } from '$lib/api/mfa';
import { loadMe } from '$lib/auth';
import { encode } from 'uqr';
import { primaryActions } from '$lib/ui/testing/primary';
import TwoFactorSetup from './TwoFactorSetup.svelte';

const options = (o: Partial<AuthOptions> = {}): AuthOptions => ({
	bootstrap: false,
	registration: 'closed',
	emailPolicy: 'optional',
	passwordReset: true,
	emailCodeLogin: false,
	passwordMinLength: 10,
	totpAvailable: true,
	mfaEnforced: true,
	...o
});
const URI = 'otpauth://totp/qinqin:bobby?secret=JBSWY3DPEHPK3PXP&issuer=qinqin&algorithm=SHA1&digits=6&period=30';
const setup = { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', otpauthUri: URI, expiresAt: 'x' };

beforeEach(() => {
	(me.current as ReturnType<typeof writable>).set({ id: 1, username: 'bobby', email: null, emailVerified: false });
	Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('forced enrolment with an authenticator app', () => {
	it('draws the QR as rects, shows the key as text with Copy, then the recovery codes behind a checkbox', async () => {
		vi.mocked(totpSetup).mockResolvedValue(setup);
		vi.mocked(totpConfirm).mockResolvedValue({ recoveryCodes: ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'] });
		const onfinished = vi.fn();
		render(TwoFactorSetup, { options: options(), forced: true, site: 'words.example.org', onfinished });
		// choosing a method has no primary action: both choices are equal
		expect(primaryActions(document.body)).toHaveLength(0);
		await fireEvent.click(screen.getByRole('button', { name: 'Authenticator app' }));
		await screen.findByRole('heading', { name: 'Scan the code' });
		// the scan step's one primary action is turning it on
		expect(primaryActions(document.body).map((b) => b.textContent?.trim())).toEqual(['Turn on']);
		// forced: no password is sent
		expect(totpSetup).toHaveBeenCalledWith({});
		const svg = screen.getByRole('img', { name: 'QR code for your authenticator app' });
		const dark = encode(URI, { ecc: 'M', border: 0 }).data.flat().filter(Boolean).length;
		const rects = [...svg.querySelectorAll('rect')].slice(1); // the first is the white ground
		expect(rects.reduce((n, r) => n + Number(r.getAttribute('width')), 0)).toBe(dark);
		expect(svg.querySelectorAll('script, foreignObject').length).toBe(0);
		// the text alternative and Copy
		expect(screen.getByTestId('secret').textContent).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
		await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
		await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(setup.secret));
		// a wrong code shows the server sentence
		vi.mocked(totpConfirm).mockRejectedValueOnce(new ApiError(403, JSON.stringify({ error: 'code_invalid', message: 'x' })));
		await fireEvent.input(screen.getByLabelText('Code from your authenticator app'), { target: { value: '000000' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
		expect((await screen.findByRole('alert')).textContent).toBe('That code is not right.');
		await fireEvent.input(screen.getByLabelText('Code from your authenticator app'), { target: { value: '123456' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
		await screen.findByRole('heading', { name: 'Save your recovery codes' });
		expect(screen.getByText('AAAA-BBBB-CCCC-DDDD')).toBeTruthy();
		expect(primaryActions(document.body).map((b) => b.textContent?.trim())).toEqual(['Continue']);
		const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
		expect(cont.disabled).toBe(true);
		await fireEvent.click(screen.getByLabelText('I have saved these codes'));
		expect(cont.disabled).toBe(false);
		await fireEvent.click(cont);
		await waitFor(() => expect(onfinished).toHaveBeenCalled());
		expect(loadMe).toHaveBeenCalled();
	});

	it('hides the secret and says why when the server has no usable secret', async () => {
		render(TwoFactorSetup, { options: options({ totpAvailable: false }), forced: true, onfinished: vi.fn() });
		expect(screen.queryByRole('button', { name: 'Authenticator app' })).toBeNull();
		expect(screen.getByText(/need QINQIN_SECRET/)).toBeTruthy();
	});

	it('hides email codes without mail', async () => {
		render(TwoFactorSetup, { options: options({ passwordReset: false }), forced: true, onfinished: vi.fn() });
		expect(screen.queryByRole('button', { name: 'Email codes' })).toBeNull();
		expect(screen.getByText(/Emailed codes need email to be set up/)).toBeTruthy();
	});
});

describe('settings enrolment', () => {
	it('asks for the password first and sends it', async () => {
		vi.mocked(totpSetup).mockResolvedValue(setup);
		render(TwoFactorSetup, { options: options(), onfinished: vi.fn() });
		await fireEvent.click(screen.getByRole('button', { name: 'Authenticator app' }));
		const password = await screen.findByLabelText('Password');
		expect(password.closest('.field')).not.toBeNull();
		// the password step's one primary action
		expect(primaryActions(document.body).map((b) => b.textContent?.trim())).toEqual(['Continue']);
		await fireEvent.input(password, { target: { value: 'secret-pass-bobby' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await screen.findByRole('heading', { name: 'Scan the code' });
		expect(totpSetup).toHaveBeenCalledWith({ password: 'secret-pass-bobby' });
	});

	it('shows a wrong password sentence', async () => {
		vi.mocked(totpSetup).mockRejectedValue(new ApiError(403, JSON.stringify({ error: 'wrong_password', message: 'x' })));
		render(TwoFactorSetup, { options: options(), onfinished: vi.fn() });
		await fireEvent.click(screen.getByRole('button', { name: 'Authenticator app' }));
		await fireEvent.input(await screen.findByLabelText('Password'), { target: { value: 'nope-nope-nope' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		expect((await screen.findByRole('alert')).textContent).toBe('The password is wrong.');
	});
});

describe('email method path', () => {
	it('adds an address, confirms it with the code, then turns the method on', async () => {
		const { verifyEmailCode } = await import('$lib/api/mfa');
		vi.mocked(putEmail).mockResolvedValue({ email: 'b@example.org', emailVerified: false, verification: 'sent' });
		vi.mocked(verifyEmailCode).mockResolvedValue({ emailVerified: true });
		vi.mocked(setEmailMethod).mockResolvedValue({ email: true });
		const onfinished = vi.fn();
		render(TwoFactorSetup, { options: options(), forced: true, onfinished });
		await fireEvent.click(screen.getByRole('button', { name: 'Email codes' }));
		const address = await screen.findByLabelText('Email address');
		expect(address.closest('.field')).not.toBeNull();
		expect(primaryActions(document.body).map((b) => b.textContent?.trim())).toEqual(['Send a code']);
		await fireEvent.input(address, { target: { value: 'b@example.org' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Send a code' }));
		expect(putEmail).toHaveBeenCalledWith('b@example.org', undefined);
		// the mailed-code step's one primary action confirms the address
		expect(primaryActions(document.body).map((b) => b.textContent?.trim())).toEqual(['Confirm address']);
		await fireEvent.input(await screen.findByLabelText('Code from the email'), { target: { value: '123456' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Confirm address' }));
		await waitFor(() => expect(verifyEmailCode).toHaveBeenCalledWith('123456'));
		(me.current as ReturnType<typeof writable>).set({ id: 1, username: 'bobby', email: 'b@example.org', emailVerified: true });
		await fireEvent.click(await screen.findByRole('button', { name: 'Turn on email codes' }));
		await waitFor(() => expect(setEmailMethod).toHaveBeenCalledWith(true, undefined));
		await waitFor(() => expect(onfinished).toHaveBeenCalled());
	});

	it('goes straight to enabling when the address is already confirmed', async () => {
		(me.current as ReturnType<typeof writable>).set({ id: 1, username: 'bobby', email: 'b@example.org', emailVerified: true });
		render(TwoFactorSetup, { options: options(), onfinished: vi.fn() });
		await fireEvent.click(screen.getByRole('button', { name: 'Email codes' }));
		expect(await screen.findByText('b@example.org')).toBeTruthy();
		expect(putEmail).not.toHaveBeenCalled();
	});
});

describe('email method in an enrolment session', () => {
	it('is finished only after the mailed code was confirmed', async () => {
		(me.current as ReturnType<typeof writable>).set({ id: 1, username: 'bobby', email: 'b@example.org', emailVerified: true });
		vi.mocked(setEmailMethod).mockResolvedValue({ confirm: true, resendAfter: 60 });
		vi.mocked(confirmEmailMethod).mockResolvedValue({ email: true });
		const onfinished = vi.fn();
		render(TwoFactorSetup, { options: options(), forced: true, onfinished });
		await fireEvent.click(screen.getByRole('button', { name: 'Email codes' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Turn on email codes' }));
		await fireEvent.input(await screen.findByLabelText('Code from the email'), { target: { value: '123456' } });
		expect(onfinished).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Turn on email codes' }));
		await waitFor(() => expect(confirmEmailMethod).toHaveBeenCalledWith('123456'));
		await waitFor(() => expect(onfinished).toHaveBeenCalled());
	});
});
