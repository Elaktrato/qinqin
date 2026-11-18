<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { putEmail, type AuthOptions } from '$lib/api/account';
	import { confirmEmailMethod, setEmailMethod, totpConfirm, totpSetup, type TotpSetup } from '$lib/api/mfa';
	import { loadMe, user } from '$lib/auth';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { Button, Field } from '$lib/ui';
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
		if (body?.error === 'wrong_password') return t('account.mfa.wrongPassword');
		if (body?.error === 'code_invalid') return codeFailure(body, fallback).text;
		return errorText(err, fallback);
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
			error = fail(err, t('account.setup.startFailed'));
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
			error = body?.error === 'setup_expired' ? t('account.setup.expired') : fail(err, t('account.verify.checkFailed'));
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
			error = t('account.setup.copyFailed');
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
			else error = t('account.setup.noMail');
			await loadMe();
		} catch (err) {
			error = fail(err, t('account.setup.saveEmailFailed'));
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
			error = fail(err, t('account.setup.emailOnFailed'));
		} finally {
			busy = false;
		}
	}
</script>

<div class="twofactor">
	{#if step === 'choose'}
		<h2 tabindex="-1" bind:this={heading}>{t('account.mfa.setUp')}</h2>
		<p>{t('account.setup.pick')}</p>
		<ul class="choices">
			{#if choices.totp}
				<li>
					<Button onclick={() => (forced ? startTotp() : go('password'))}>{t('account.setup.app')}</Button>
					<span class="hint">{t('account.setup.appHint')}</span>
				</li>
			{:else if choices.totpWhy}
				<li class="hint">{choices.totpWhy}</li>
			{/if}
			{#if choices.email}
				<li>
					<Button onclick={() => go('email')}>{t('account.setup.email')}</Button>
					<span class="hint">{t('account.setup.emailHint')}</span>
				</li>
			{:else if options}
				<li class="hint">{choices.emailWhy}</li>
			{/if}
		</ul>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	{:else if step === 'password'}
		<h2 tabindex="-1" bind:this={heading}>{t('account.setup.confirmPassword')}</h2>
		<form onsubmit={startTotp}>
			<Field
				label={t('account.field.password')}
				type="password"
				name="password"
				autocomplete="current-password"
				bind:value={password}
				required
			/>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<Button type="submit" variant="primary" busy={busy} disabled={!password}
				>{t('common.action.continue')}</Button
			>
			<Button variant="plain" onclick={() => go('choose')}>{t('common.action.back')}</Button>
		</form>
	{:else if step === 'scan' && setup}
		<h2 tabindex="-1" bind:this={heading}>{t('account.setup.scanTitle')}</h2>
		<ol>
			<li>{t('account.setup.scanStep1')}</li>
			<li>{t('account.setup.scanStep2')}</li>
			<li>{t('account.setup.scanStep3')}</li>
		</ol>
		<QrCode text={setup.otpauthUri} />
		<p>
			{t('account.setup.key')} <code class="secret" data-testid="secret">{groupSecret(setup.secret)}</code>
			<Button variant="plain" onclick={copySecret}>{copied ? t('common.action.copied') : t('common.action.copy')}</Button>
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
			<Button type="submit" variant="primary" busy={busy} disabled={!otpComplete(code, 'totp')}
				>{t('account.setup.turnOn')}</Button
			>
		</form>
	{:else if step === 'codes'}
		<RecoveryCodes codes={recovery} {site} oncontinue={finish} />
	{:else if step === 'email'}
		<h2 tabindex="-1" bind:this={heading}>{t('account.setup.email')}</h2>
		{#if confirming}
			<EmailVerify
				address={$user?.email ?? ''}
				verify={confirmEmailMethod}
				resend={async () => (await setEmailMethod(true)) as { resendAfter?: number }}
				submitLabel={t('account.setup.turnOnEmail')}
				onverified={finish}
			/>
		{:else if emailReady}
			<p>
				<Msg key="account.setup.codesGoTo" args={{ address: $user?.email ?? '' }}>{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg>
			</p>
			<form onsubmit={enableEmail}>
				{#if !forced}
					<Field
						label={t('account.field.password')}
						type="password"
						name="password"
						autocomplete="current-password"
						bind:value={password}
						required
					/>
				{/if}
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<Button type="submit" variant="primary" busy={busy} disabled={!forced && !password}
					>{t('account.setup.turnOnEmail')}</Button
				>
				<Button variant="plain" onclick={() => go('choose')}>{t('common.action.back')}</Button>
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
			<p>{t('account.setup.addEmailFirst')}</p>
			<form onsubmit={saveEmail}>
				<Field
					label={t('account.setup.emailAddress')}
					type="email"
					name="email"
					autocomplete="email"
					bind:value={emailDraft}
					required
				/>
				{#if !forced}
					<Field
						label={t('account.field.password')}
						type="password"
						name="password"
						autocomplete="current-password"
						bind:value={password}
						required
					/>
				{/if}
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<Button type="submit" variant="primary" busy={busy}>{t('account.setup.sendCode')}</Button>
				<Button variant="plain" onclick={() => go('choose')}>{t('common.action.back')}</Button>
			</form>
		{/if}
	{/if}
</div>

<style>
	/* The two choices are equal: hairline rows, no box, no primary (#106). */
	.choices {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.choices li {
		display: grid;
		gap: var(--space-1);
		justify-items: start;
		padding-block: var(--space-3);
	}
	.choices li + li {
		border-top: 1px solid var(--hair);
	}
	.hint {
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}
	.error {
		margin: 0;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
	}
	.secret {
		font-size: var(--font-size-m);
		letter-spacing: 0.04em;
		word-break: break-all;
	}
</style>
