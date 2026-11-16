<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { pageTitle } from '$lib/pageTitle';
	import { authErrorMessage } from '$lib/api/authErrors';
	import { apiErrorBody } from '$lib/api/client';
	import { getAuthOptions, type AuthOptions } from '$lib/api/account';
	import { emailLoginStart, mfaSendEmail } from '$lib/api/mfa';
	import { completeEmailLogin, completeMfa, signIn, type SignInResult } from '$lib/auth';
	import { firstMethod, otherMethods, type MfaChallenge, type MfaMethod } from '$lib/account/loginFlow';
	import { codeFailure, otpAttrs, otpComplete, resendText, sanitizeOtp } from '$lib/account/otpInput';

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
				live = 'A new code can be requested now.';
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
		void run(async () => settled(await signIn(username.trim(), password)), 'Login failed.');
	}

	function submitCode(event: SubmitEvent) {
		event.preventDefault();
		if (!mfa || !otpComplete(code, method)) return;
		void run(async () => settled(await completeMfa(mfa!.challenge, method, code)), 'Could not check the code.');
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
			sentTo = mfa!.emailHint ?? 'your email address';
			live = `A code was sent to ${sentTo}.`;
			startCountdown(res.resendAfter);
		}, 'Could not send the code.');
	}

	function startEmailLogin(event?: SubmitEvent) {
		event?.preventDefault();
		void run(async () => {
			const started = await emailLoginStart(emailLogin.trim());
			codeChallenge = started.challenge;
			sentTo = 'the address on the account, if it has a confirmed one';
			live = 'Code requested.';
			startCountdown(started.resendAfter);
			await enter('emailCode');
		}, 'Could not send a code.');
	}

	function submitEmailLogin(event: SubmitEvent) {
		event.preventDefault();
		if (!otpComplete(code, 'email')) return;
		void run(async () => settled(await completeEmailLogin(codeChallenge, code)), 'Could not check the code.');
	}

	function oninput(event: Event, as: MfaMethod) {
		const el = event.currentTarget as HTMLInputElement;
		code = sanitizeOtp(el.value, as);
		el.value = code;
	}
</script>

<svelte:head>
	<title>{pageTitle('Sign in')}</title>
</svelte:head>

<main class="auth">
	{#if view === 'password'}
		<h1 tabindex="-1" bind:this={heading}>Sign in</h1>

		<form onsubmit={submitPassword}>
			<label>
				Username
				<input name="username" autocomplete="username" bind:value={username} required />
			</label>

			<label>
				Password
				<input
					name="password"
					type="password"
					autocomplete="current-password"
					bind:value={password}
					required
				/>
			</label>

			{#if notice}
				<p class="hint" role="status">{notice}</p>
			{/if}
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			<button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
		</form>

		{#if options?.emailCodeLogin}
			<p class="hint"><button type="button" class="link" onclick={() => enter('emailStart')}>Email me a sign-in code</button></p>
		{/if}
	{:else if view === 'mfa' && mfa}
		<h1 tabindex="-1" bind:this={heading}>Two-step check</h1>
		<form onsubmit={submitCode}>
			{#if method === 'email'}
				<p>We emailed a code to <strong>{mfa.emailHint ?? 'your address'}</strong>. {sentTo ? '' : 'Sending it…'}</p>
			{:else if method === 'recovery'}
				<p>Enter one of the recovery codes you saved when you set up two-step sign-in. Each works once.</p>
			{:else}
				<p>Enter the 6-digit code from your authenticator app.</p>
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
			<button type="submit" disabled={busy || !otpComplete(code, method)}>{busy ? 'Checking…' : 'Continue'}</button>
		</form>
		{#if method === 'email'}
			<p class="hint">
				{resendText(resendLeft)}
				<button type="button" class="link" disabled={busy || resendLeft > 0} onclick={sendMfaEmail}>Send a new code</button>
			</p>
		{/if}
		<p class="hint">
			{#each others as other (other)}
				<button type="button" class="link" onclick={() => pick(other)}>
					{other === 'recovery' ? 'Use a recovery code' : other === 'email' ? 'Email me a code instead' : 'Use my authenticator app'}
				</button>
			{/each}
			<button type="button" class="link" onclick={() => backToStart('')}>Back to sign in</button>
		</p>
		<p class="sr-only" aria-live="polite">{live}</p>
	{:else if view === 'emailStart'}
		<h1 tabindex="-1" bind:this={heading}>Sign in with an emailed code</h1>
		<form onsubmit={startEmailLogin}>
			<label>
				Username or email address
				<input name="login" autocomplete="username" bind:value={emailLogin} required />
			</label>
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
			<button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
		</form>
		<p class="hint"><button type="button" class="link" onclick={() => enter('password')}>Back to sign in</button></p>
	{:else if view === 'emailCode'}
		<h1 tabindex="-1" bind:this={heading}>Enter your code</h1>
		<form onsubmit={submitEmailLogin}>
			<p>If the account has a confirmed email address, we sent it a 6-digit code.</p>
			<label>
				Code from the email
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
			<button type="submit" disabled={busy || !otpComplete(code, 'email')}>{busy ? 'Checking…' : 'Sign in'}</button>
		</form>
		<p class="hint">
			{resendText(resendLeft)}
			<button type="button" class="link" disabled={busy || resendLeft > 0} onclick={() => startEmailLogin()}>Send a new code</button>
		</p>
		<p class="hint"><button type="button" class="link" onclick={() => backToStart('')}>Back to sign in</button></p>
		<p class="sr-only" aria-live="polite">{live}</p>
	{/if}

	{#if view === 'password' && options}
		{#if options.bootstrap || options.registration === 'open'}
			<p class="hint">No account yet? <a href="/register">Create one</a>.</p>
		{:else if options.registration === 'invite'}
			<p class="hint">Have an invite link? Open it to register.</p>
		{/if}
		{#if options.passwordReset}
			<p class="hint"><a href="/reset">Forgot password?</a></p>
		{:else}
			<p class="hint">Forgot your password? Ask your administrator for a reset link.</p>
		{/if}
	{/if}
</main>
