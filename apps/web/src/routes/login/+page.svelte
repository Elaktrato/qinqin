<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { goto } from '$app/navigation';
	import { ApiError } from '$lib/api/client';
	import { login } from '$lib/auth';

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
			await login(username.trim(), password);
			await goto('/');
		} catch (err) {
			error =
				err instanceof ApiError && err.status === 401
					? 'Wrong username or password.'
					: err instanceof Error
						? err.message
						: 'Login failed.';
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

	<p class="hint">No account yet? <a href="/register">Create one</a>.</p>
</main>
