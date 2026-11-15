<script lang="ts">
	import { onMount } from 'svelte';
	import { pageTitle } from '$lib/pageTitle';
	import { authErrorMessage } from '$lib/api/authErrors';
	import { getAuthOptions, type AuthOptions } from '$lib/api/account';
	import { login } from '$lib/auth';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);
	let options = $state<AuthOptions | null>(null);

	onMount(() => {
		// The links below follow the instance's switches; without them the page
		// still signs in.
		getAuthOptions().then(
			(o) => (options = o),
			() => undefined
		);
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;

		error = '';
		busy = true;
		try {
			await login(username.trim(), password);
			// The layout guard moves a signed-in session off this page.
		} catch (err) {
			error = authErrorMessage(err, 'Login failed.');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle('Sign in')}</title>
</svelte:head>

<main class="auth">
	<h1>Sign in</h1>

	<form onsubmit={submit}>
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

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		<button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
	</form>

	{#if options}
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
