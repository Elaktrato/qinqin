<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { authErrorMessage } from '$lib/api/authErrors';
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
			// The layout guard moves a signed-in session off this page.
		} catch (err) {
			error = authErrorMessage(err, 'Registration failed.');
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
