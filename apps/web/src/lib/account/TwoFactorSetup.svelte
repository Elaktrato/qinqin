<script lang="ts">
	import { tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { putEmail, type AuthOptions } from '$lib/api/account';
	import { confirmEmailMethod, setEmailMethod, totpConfirm, totpSetup, type TotpSetup } from '$lib/api/mfa';
	import { loadMe, user } from '$lib/auth';
	import { codeFailure, otpAttrs, otpComplete, sanitizeOtp } from './otpInput';
	import { groupSecret, twoFactorChoices } from './mfaView';
	import EmailVerify from './EmailVerify.svelte';
	import QrCode from './QrCode.svelte';
	import RecoveryCodes from './RecoveryCodes.svelte';

	// One component for the forced enrolment page and for Settings, Account.
	// `forced`: the session is an enrolment session: no password is asked (the
	// server skips it there) and finishing makes the session a full one.
	let {
		options,
		forced = false,
		site = location.host,
		onfinished
	}: { options: AuthOptions | null; forced?: boolean; site?: string; onfinished: () => void } = $props();

	type Step = 'choose' | 'password' | 'scan' | 'codes' | 'email';
	let step = $state<Step>('choose');
	let heading: HTMLElement | undefined = $state();
	let password = $state('');
	let setup = $state<TotpSetup | null>(null);
	let code = $state('');
	let recovery = $state<string[]>([]);
	let error = $state('');
	let busy = $state(false);
	let copied = $state(false);

	// email path
	let emailDraft = $state('');
	let verifying = $state(false);
	let confirming = $state(false);
	let verifyAddress = $state('');

	const choices = $derived(twoFactorChoices(options));
	const attrs = otpAttrs('totp');
	const emailReady = $derived($user?.email && $user.emailVerified);

	async function go(next: Step) {
		step = next;
		error = '';
		await tick();
		heading?.focus();
	}

	function fail(err: unknown, fallback: string) {
		const body = apiErrorBody(err);
		if (body?.error === 'wrong_password') return 'The password is wrong.';
		if (body?.error === 'code_invalid') return codeFailure(body, fallback).text;
		return body?.message || (err instanceof Error ? err.message : '') || fallback;
	}

	async function startTotp(event?: SubmitEvent) {
		event?.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			setup = await totpSetup(forced ? {} : { password });
			password = '';
			code = '';
			await go('scan');
		} catch (err) {
			error = fail(err, 'Could not start the setup.');
		} finally {
			busy = false;
		}
	}

	async function confirm(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !otpComplete(code, 'totp')) return;
		busy = true;
		error = '';
		try {
			recovery = (await totpConfirm(code)).recoveryCodes;
			setup = null;
			await go('codes');
		} catch (err) {
			const body = apiErrorBody(err);
			error = body?.error === 'setup_expired' ? 'The setup took too long. Start again.' : fail(err, 'Could not check the code.');
			if (body?.error === 'setup_expired') await go('choose');
		} finally {
			busy = false;
		}
	}

	async function copySecret() {
		try {
			await navigator.clipboard.writeText(setup?.secret ?? '');
			copied = true;
		} catch {
			error = 'Could not copy. Select the key and copy it by hand.';
		}
	}

	async function finish() {
		await loadMe();
		onfinished();
	}

	async function saveEmail(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			const res = await putEmail(emailDraft.trim(), forced ? undefined : password);
			password = '';
			verifyAddress = emailDraft.trim();
			if (res.verification === 'sent') verifying = true;
			else error = 'This server cannot send mail right now. Choose the authenticator app instead.';
			await loadMe();
		} catch (err) {
			error = fail(err, 'Could not save the email address.');
		} finally {
			busy = false;
		}
	}

	async function enableEmail(event?: SubmitEvent) {
		event?.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			const res = await setEmailMethod(true, forced ? undefined : password);
			// An enrolment session must first prove the mailbox with a code.
			if (res.confirm) confirming = true;
			else await finish();
		} catch (err) {
			error = fail(err, 'Could not turn on emailed codes.');
		} finally {
			busy = false;
		}
	}
</script>

<div class="twofactor">
	{#if step === 'choose'}
		<h2 tabindex="-1" bind:this={heading}>Set up two-step sign-in</h2>
		<p>Pick how you will prove it is you after your password.</p>
		<ul class="choices">
			{#if choices.totp}
				<li>
					<button type="button" onclick={() => (forced ? startTotp() : go('password'))}>Authenticator app</button>
					<span class="hint">An app such as Aegis, 2FAS or Google Authenticator makes a code every 30 seconds. Works offline.</span>
				</li>
			{:else if choices.totpWhy}
				<li class="hint">{choices.totpWhy}</li>
			{/if}
			{#if choices.email}
				<li>
					<button type="button" onclick={() => go('email')}>Email codes</button>
					<span class="hint">We mail a 6-digit code to your confirmed address each time you sign in.</span>
				</li>
			{:else if options}
				<li class="hint">{choices.emailWhy}</li>
			{/if}
		</ul>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	{:else if step === 'password'}
		<h2 tabindex="-1" bind:this={heading}>Confirm your password</h2>
		<form onsubmit={startTotp}>
			<label>
				Password
				<input type="password" name="password" autocomplete="current-password" bind:value={password} required />
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button type="submit" disabled={busy || !password}>Continue</button>
			<button type="button" class="link" onclick={() => go('choose')}>Back</button>
		</form>
	{:else if step === 'scan' && setup}
		<h2 tabindex="-1" bind:this={heading}>Scan the code</h2>
		<ol>
			<li>Open your authenticator app and add an account.</li>
			<li>Scan this picture, or type the key below.</li>
			<li>Enter the 6-digit code the app shows.</li>
		</ol>
		<QrCode text={setup.otpauthUri} />
		<p>
			Key: <code class="secret" data-testid="secret">{groupSecret(setup.secret)}</code>
			<button type="button" class="link" onclick={copySecret}>{copied ? 'Copied' : 'Copy'}</button>
		</p>
		<form onsubmit={confirm}>
			<label>
				{attrs.label}
				<input
					name="code"
					inputmode={attrs.inputmode}
					autocomplete={attrs.autocomplete}
					maxlength={attrs.maxlength}
					value={code}
					oninput={(e) => {
						code = sanitizeOtp(e.currentTarget.value, 'totp');
						e.currentTarget.value = code;
					}}
					required
				/>
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button type="submit" disabled={busy || !otpComplete(code, 'totp')}>Turn on</button>
		</form>
	{:else if step === 'codes'}
		<RecoveryCodes codes={recovery} {site} oncontinue={finish} />
	{:else if step === 'email'}
		<h2 tabindex="-1" bind:this={heading}>Email codes</h2>
		{#if confirming}
			<EmailVerify
				address={$user?.email ?? ''}
				verify={confirmEmailMethod}
				resend={async () => (await setEmailMethod(true)) as { resendAfter?: number }}
				submitLabel="Turn on email codes"
				onverified={finish}
			/>
		{:else if emailReady}
			<p>Codes will go to <strong>{$user?.email}</strong>.</p>
			<form onsubmit={enableEmail}>
				{#if !forced}
					<label>
						Password
						<input type="password" name="password" autocomplete="current-password" bind:value={password} required />
					</label>
				{/if}
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<button type="submit" disabled={busy || (!forced && !password)}>Turn on email codes</button>
				<button type="button" class="link" onclick={() => go('choose')}>Back</button>
			</form>
		{:else if verifying}
			<EmailVerify
				address={verifyAddress}
				onverified={async () => {
					verifying = false;
					await loadMe();
				}}
			/>
		{:else}
			<p>Add an email address first. We send a code to confirm it.</p>
			<form onsubmit={saveEmail}>
				<label>
					Email address
					<input type="email" name="email" autocomplete="email" bind:value={emailDraft} required />
				</label>
				{#if !forced}
					<label>
						Password
						<input type="password" name="password" autocomplete="current-password" bind:value={password} required />
					</label>
				{/if}
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<button type="submit" disabled={busy}>Send a code</button>
				<button type="button" class="link" onclick={() => go('choose')}>Back</button>
			</form>
		{/if}
	{/if}
</div>

<style>
	.choices {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}
	.choices li {
		display: grid;
		gap: 0.25rem;
	}
	.secret {
		font-size: 1.05rem;
		letter-spacing: 0.04em;
		word-break: break-all;
	}
</style>
