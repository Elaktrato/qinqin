<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
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
				problem = authErrorMessage(err, t('auth.reset.linkInvalid'));
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
			error = authErrorMessage(err, t('auth.reset.requestFailed'));
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
			error = authErrorMessage(err, t('auth.reset.failed'));
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(t('auth.reset.title'))}</title>
</svelte:head>

<main class="auth">
	<h1>{t('auth.reset.title')}</h1>
	{#if !loaded}
		<p class="hint" role="status">{t('auth.reset.checking')}</p>
	{:else if problem}
		<p class="error" role="alert">{problem}</p>
		<p class="hint"><a href="/login">{t('auth.mfa.backToSignIn')}</a></p>
	{:else if passwordChanged}
		<p role="status">{t('auth.reset.changed')}</p>
		<p class="hint"><a href="/login">{t('auth.reset.goToSignIn')}</a></p>
	{:else if token}
		<form onsubmit={submit}>
			<p>
				<Msg key="auth.reset.chooseFor" args={{ username }}>{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg>
			</p>
			<label>
				{t('auth.reset.newPassword')}
				<input type="password" autocomplete="new-password" aria-describedby="reset-rules" bind:value={password} required />
			</label>
			<p class="hint" id="reset-rules">{passwordHint()}</p>
			<label>
				{t('auth.reset.repeat')}
				<input type="password" autocomplete="new-password" bind:value={confirm} required />
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button type="submit" disabled={busy}>{busy ? t('auth.reset.saving') : t('auth.reset.submit')}</button>
		</form>
	{:else if mailReset}
		{#if requested}
			<p role="status">{t('auth.reset.requested')}</p>
			<p class="hint"><a href="/login">{t('auth.mfa.backToSignIn')}</a></p>
		{:else}
			<form onsubmit={request}>
				<p>{t('auth.reset.requestIntro')}</p>
				<label>
					{t('auth.emailLogin.login')}
					<input name="login" autocomplete="username" bind:value={login} required />
				</label>
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<button type="submit" disabled={busy}>{busy ? t('auth.emailLogin.sending') : t('auth.reset.send')}</button>
			</form>
			<p class="hint"><a href="/login">{t('auth.mfa.backToSignIn')}</a></p>
		{/if}
	{:else}
		<p>{t('auth.reset.askAdmin')}</p>
		<p class="hint"><a href="/login">{t('auth.mfa.backToSignIn')}</a></p>
	{/if}
</main>
