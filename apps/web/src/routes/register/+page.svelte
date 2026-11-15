<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { goto } from '$app/navigation';
	import { ApiError } from '$lib/api/client';
	import { register } from '$lib/auth';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;

		error = '';
		busy = true;
		try {
			await register(username.trim(), password);
			await goto('/');
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				error = 'That username is already taken.';
			} else if (err instanceof ApiError && err.status === 403) {
				error = 'Only an administrator can create more accounts.';
			} else {
				error = err instanceof Error ? err.message : 'Registration failed.';
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle('Create account')}</title>
</svelte:head>

<main class="auth">
	<h1>Create account</h1>

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
				autocomplete="new-password"
				bind:value={password}
				required
			/>
		</label>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		<button type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
	</form>

	<p class="hint">
		Already have an account? <a href="/login">Sign in</a>. The first account on a fresh instance
		becomes the administrator.
	</p>
</main>
