<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { pageTitle } from '$lib/pageTitle';
	import { authErrorMessage } from '$lib/api/authErrors';
	import { checkReset, getAuthOptions, useReset } from '$lib/api/account';
	import { resetRequest } from '$lib/api/mfa';
	import { readFragment } from '$lib/account/fragment';
	import { hasSession, stepFor } from '$lib/account/loginFlow';
	import { confirmProblem, passwordHint, passwordProblem } from '$lib/account/passwordRules';
	import { signInWithToken } from '$lib/auth';

	let token = $state('');
	let username = $state('');
	let loaded = $state(false);
	let problem = $state('');
	let password = $state('');
	let confirm = $state('');
	let error = $state('');
	let busy = $state(false);
	let mailReset = $state<boolean | null>(null);
	let login = $state('');
	let requested = $state(false);
	let passwordChanged = $state(false);

	onMount(async () => {
		const read = readFragment(location.hash, 't', location.pathname + location.search);
		if (read.value) {
			history.replaceState(null, '', read.cleaned);
			token = read.value;
			try {
				username = (await checkReset(token)).username;
			} catch (err) {
				problem = authErrorMessage(err, 'This link is not valid any more. Ask for a new one.');
			}
		}
		if (!token) {
			try {
				mailReset = (await getAuthOptions()).passwordReset;
			} catch {
				mailReset = false;
			}
		}
		loaded = true;
	});

	async function request(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		error = '';
		busy = true;
		try {
			await resetRequest(login.trim());
			requested = true;
		} catch (err) {
			error = authErrorMessage(err, 'Could not send the request.');
		} finally {
			busy = false;
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		error = passwordProblem(username, password) ?? confirmProblem(password, confirm) ?? '';
		if (error) return;
		busy = true;
		try {
			const res = await useReset(token, password);
			const step = stepFor(res.status, res);
			if (step.kind === 'mfa' || res.status === 'password_changed') {
				// The password is changed, but two-step sign-in still applies: finish on the sign-in page.
				passwordChanged = true;
				return;
			}
			if (!hasSession(step) || !res.token) throw new Error('This sign-in step is not supported by this app version.');
			// A successful reset replaces whatever session this browser had.
			await signInWithToken(res.token);
			await goto('/');
		} catch (err) {
			error = authErrorMessage(err, 'Could not reset the password.');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle('Reset password')}</title>
</svelte:head>

<main class="auth">
	<h1>Reset password</h1>
	{#if !loaded}
		<p class="hint" role="status">Checking your link…</p>
	{:else if problem}
		<p class="error" role="alert">{problem}</p>
		<p class="hint"><a href="/login">Back to sign in</a></p>
	{:else if passwordChanged}
		<p role="status">Your password was changed. Sign in with it to finish: your account also needs its second step.</p>
		<p class="hint"><a href="/login">Go to sign in</a></p>
	{:else if token}
		<form onsubmit={submit}>
			<p>Choose a new password for <strong>{username}</strong>.</p>
			<label>
				New password
				<input type="password" autocomplete="new-password" aria-describedby="reset-rules" bind:value={password} required />
			</label>
			<p class="hint" id="reset-rules">{passwordHint()}</p>
			<label>
				Repeat the new password
				<input type="password" autocomplete="new-password" bind:value={confirm} required />
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set password and sign in'}</button>
		</form>
	{:else if mailReset}
		{#if requested}
			<p role="status">If the account has a verified email address, we sent a link to reset the password. It works for one hour.</p>
			<p class="hint"><a href="/login">Back to sign in</a></p>
		{:else}
			<form onsubmit={request}>
				<p>Enter your username or the email address of your account. If it has a verified address, we mail you a reset link.</p>
				<label>
					Username or email address
					<input name="login" autocomplete="username" bind:value={login} required />
				</label>
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
			</form>
			<p class="hint"><a href="/login">Back to sign in</a></p>
		{/if}
	{:else}
		<p>Ask your administrator for a reset link, then open it.</p>
		<p class="hint"><a href="/login">Back to sign in</a></p>
	{/if}
</main>
