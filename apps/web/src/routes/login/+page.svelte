<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { pageTitle } from '$lib/routing/pageTitle';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { authErrorMessage } from '$lib/api/authErrors';
	import { apiErrorBody } from '$lib/api/client';
	import { getAuthOptions, type AuthOptions } from '$lib/api/account';
	import { emailLoginStart, mfaSendEmail } from '$lib/api/mfa';
	import { firstMethod, otherMethods, type MfaChallenge, type MfaMethod } from '$lib/account/loginFlow';
	import { codeFailure, otpAttrs, otpComplete, resendText, sanitizeOtp } from '$lib/account/otpInput';
	import { Button, Field } from '$lib/ui';
	import type { SignInResult } from '$lib/auth/auth.svelte';
	import { useApp } from '$lib/context/context';
	const app = useApp();

	type View = 'password' | 'mfa' | 'emailStart' | 'emailCode';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let notice = $state('');
	let busy = $state(false);
	let options = $state<AuthOptions | null>(null);

	let view = $state<View>('password');
	let mfa = $state<MfaChallenge | null>(null);
	let method = $state<MfaMethod>('totp');
	let code = $state('');
	// The emailed code's challenge (sign-in code) and the resend countdown.
	let codeChallenge = $state('');
	let emailLogin = $state('');
	let sentTo = $state('');
	let resendLeft = $state(0);
	let live = $state('');
	let heading: HTMLHeadingElement | undefined = $state();
	let timer: ReturnType<typeof setInterval> | undefined;

	const attrs = $derived(otpAttrs(method));
	const others = $derived(mfa ? otherMethods(mfa.methods, method) : []);

	onMount(() => {
		// The links below follow the instance's switches; without them the page
		// still signs in.
		getAuthOptions().then(
			(o) => (options = o),
			() => undefined
		);
	});
	onDestroy(() => clearInterval(timer));

	function startCountdown(seconds: number) {
		clearInterval(timer);
		resendLeft = seconds;
		timer = setInterval(() => {
			resendLeft = Math.max(0, resendLeft - 1);
			if (resendLeft === 0) {
				clearInterval(timer);
				live = t('auth.mfa.canRequestNow');
			}
		}, 1000);
	}

	async function enter(next: View) {
		view = next;
		error = '';
		code = '';
		await tick();
		heading?.focus();
	}

	async function settled(result: SignInResult) {
		if (result.kind === 'mfa') {
			mfa = result.mfa;
			method = firstMethod(result.mfa.methods);
			notice = '';
			await enter('mfa');
		}
		// A session: the layout guard moves it off this page.
	}

	async function backToStart(text: string) {
		clearInterval(timer);
		mfa = null;
		codeChallenge = '';
		await enter('password');
		notice = text;
	}

	async function run(fn: () => Promise<void>, fallback: string) {
		if (busy) return;
		error = '';
		busy = true;
		try {
			await fn();
		} catch (err) {
			const failure = codeFailure(apiErrorBody(err), authErrorMessage(err, fallback));
			if (failure.restart) await backToStart(failure.text);
			else error = view === 'password' || view === 'emailStart' ? authErrorMessage(err, fallback) : failure.text;
		} finally {
			busy = false;
		}
	}

	function submitPassword(event: SubmitEvent) {
		event.preventDefault();
		notice = '';
		void run(async () => settled(await app.auth.signIn(username.trim(), password)), t('auth.signIn.failed'));
	}

	function submitCode(event: SubmitEvent) {
		event.preventDefault();
		if (!mfa || !otpComplete(code, method)) return;
		void run(async () => settled(await app.auth.completeMfa(mfa!.challenge, method, code)), t('account.verify.checkFailed'));
	}

	function pick(next: MfaMethod) {
		method = next;
		code = '';
		error = '';
		if (next === 'email' && mfa && resendLeft === 0) void sendMfaEmail();
	}

	async function sendMfaEmail() {
		if (!mfa) return;
		await run(async () => {
			const res = await mfaSendEmail(mfa!.challenge);
			sentTo = mfa!.emailHint ?? t('auth.mfa.yourEmail');
			live = t('account.verify.codeSent', { address: sentTo });
			startCountdown(res.resendAfter);
		}, t('auth.mfa.sendFailed'));
	}

	function startEmailLogin(event?: SubmitEvent) {
		event?.preventDefault();
		void run(async () => {
			const started = await emailLoginStart(emailLogin.trim());
			codeChallenge = started.challenge;
			sentTo = t('auth.emailLogin.sentTo');
			live = t('auth.emailLogin.requested');
			startCountdown(started.resendAfter);
			await enter('emailCode');
		}, t('auth.emailLogin.sendFailed'));
	}

	function submitEmailLogin(event: SubmitEvent) {
		event.preventDefault();
		if (!otpComplete(code, 'email')) return;
		void run(async () => settled(await app.auth.completeEmailLogin(codeChallenge, code)), t('account.verify.checkFailed'));
	}

	function oninput(event: Event, as: MfaMethod) {
		const el = event.currentTarget as HTMLInputElement;
		code = sanitizeOtp(el.value, as);
		el.value = code;
	}
</script>

<svelte:head>
	<title>{pageTitle(t('auth.signIn.title'))}</title>
</svelte:head>

<div class="page-body auth">
	{#if view === 'password'}
		<h1 tabindex="-1" bind:this={heading}>{t('auth.signIn.title')}</h1>

		<form onsubmit={submitPassword}>
			<Field
				label={t('auth.signIn.username')}
				name="username"
				autocomplete="username"
				bind:value={username}
				required
			/>

			<Field
				label={t('account.field.password')}
				name="password"
				type="password"
				autocomplete="current-password"
				bind:value={password}
				required
			/>

			{#if notice}
				<p class="hint" role="status">{notice}</p>
			{/if}
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			<Button type="submit" variant="primary" busy={busy}
				>{busy ? t('auth.signIn.signingIn') : t('auth.signIn.submit')}</Button
			>
		</form>

		{#if options?.emailCodeLogin}
			<p class="hint"><Button variant="plain" onclick={() => enter('emailStart')}>{t('auth.signIn.emailCodeLink')}</Button></p>
		{/if}
	{:else if view === 'mfa' && mfa}
		<h1 tabindex="-1" bind:this={heading}>{t('auth.mfa.title')}</h1>
		<form onsubmit={submitCode}>
			{#if method === 'email'}
				<p>
					<Msg key="auth.mfa.emailedTo" args={{ address: mfa.emailHint ?? t('auth.mfa.yourAddress') }}
						>{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg
					>
					{sentTo ? '' : t('auth.mfa.sending')}
				</p>
			{:else if method === 'recovery'}
				<p>{t('auth.mfa.recoveryIntro')}</p>
			{:else}
				<p>{t('auth.mfa.appIntro')}</p>
			{/if}
			<label>
				{attrs.label}
				<input
					name="code"
					inputmode={attrs.inputmode}
					autocomplete={attrs.autocomplete}
					maxlength={attrs.maxlength}
					value={code}
					oninput={(e) => oninput(e, method)}
					required
				/>
			</label>
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
			<Button type="submit" variant="primary" busy={busy} disabled={!otpComplete(code, method)}
				>{busy ? t('auth.mfa.checking') : t('common.action.continue')}</Button
			>
		</form>
		{#if method === 'email'}
			<p class="hint">
				{resendText(resendLeft)}
				<Button variant="plain" disabled={busy || resendLeft > 0} onclick={sendMfaEmail}>{t('account.verify.sendNew')}</Button>
			</p>
		{/if}
		<p class="hint">
			{#each others as other (other)}
				<Button variant="plain" onclick={() => pick(other)}>
					{other === 'recovery' ? t('auth.mfa.useRecovery') : other === 'email' ? t('auth.mfa.useEmail') : t('auth.mfa.useApp')}
				</Button>
			{/each}
			<Button variant="plain" onclick={() => backToStart('')}>{t('auth.mfa.backToSignIn')}</Button>
		</p>
		<p class="sr-only" aria-live="polite">{live}</p>
	{:else if view === 'emailStart'}
		<h1 tabindex="-1" bind:this={heading}>{t('auth.emailLogin.title')}</h1>
		<form onsubmit={startEmailLogin}>
			<Field
				label={t('auth.emailLogin.login')}
				name="login"
				autocomplete="username"
				bind:value={emailLogin}
				required
			/>
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
			<Button type="submit" variant="primary" busy={busy}
				>{busy ? t('auth.emailLogin.sending') : t('auth.emailLogin.submit')}</Button
			>
		</form>
		<p class="hint"><Button variant="plain" onclick={() => enter('password')}>{t('auth.mfa.backToSignIn')}</Button></p>
	{:else if view === 'emailCode'}
		<h1 tabindex="-1" bind:this={heading}>{t('auth.emailLogin.codeTitle')}</h1>
		<form onsubmit={submitEmailLogin}>
			<p>{t('auth.emailLogin.sentIntro')}</p>
			<label>
				{t('account.otp.emailCode')}
				<input
					name="code"
					inputmode="numeric"
					autocomplete="one-time-code"
					maxlength="6"
					value={code}
					oninput={(e) => oninput(e, 'email')}
					required
				/>
			</label>
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
			<Button type="submit" variant="primary" busy={busy} disabled={!otpComplete(code, 'email')}
				>{busy ? t('auth.mfa.checking') : t('auth.signIn.submit')}</Button
			>
		</form>
		<p class="hint">
			{resendText(resendLeft)}
			<Button variant="plain" disabled={busy || resendLeft > 0} onclick={() => startEmailLogin()}>{t('account.verify.sendNew')}</Button>
		</p>
		<p class="hint"><Button variant="plain" onclick={() => backToStart('')}>{t('auth.mfa.backToSignIn')}</Button></p>
		<p class="sr-only" aria-live="polite">{live}</p>
	{/if}

	{#if view === 'password' && options}
		{#if options.bootstrap || options.registration === 'open'}
			<p class="hint">
				<Msg key="auth.signIn.noAccount">{#snippet link(text: string)}<a href="/register">{text}</a>{/snippet}</Msg>
			</p>
		{:else if options.registration === 'invite'}
			<p class="hint">{t('auth.signIn.invite')}</p>
		{/if}
		{#if options.passwordReset}
			<p class="hint"><a href="/reset">{t('auth.signIn.forgot')}</a></p>
		{:else}
			<p class="hint">{t('auth.signIn.forgotAsk')}</p>
		{/if}
	{/if}
</div>
