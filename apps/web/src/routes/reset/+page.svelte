<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { pageTitle } from '$lib/pageTitle';
	import { authErrorMessage } from '$lib/api/authErrors';
	import { checkReset, useReset } from '$lib/api/account';
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
		loaded = true;
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		error = passwordProblem(username, password) ?? confirmProblem(password, confirm) ?? '';
		if (error) return;
		busy = true;
		try {
			const res = await useReset(token, password);
			if (!hasSession(stepFor(res.status))) throw new Error('This sign-in step is not supported by this app version.');
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
	{:else}
		<p>Ask your administrator for a reset link, then open it.</p>
		<p class="hint"><a href="/login">Back to sign in</a></p>
	{/if}
</main>
