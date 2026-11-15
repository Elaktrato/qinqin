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
			<input
				name="username"
				autocomplete="username"
				aria-describedby="username-rules"
				bind:value={username}
				required
			/>
		</label>
		<p class="hint" id="username-rules">3 to 32 letters, digits, dots, underscores or hyphens.</p>

		<label>
			Password
			<input
				name="password"
				type="password"
				autocomplete="new-password"
				aria-describedby="password-rules"
				bind:value={password}
				required
			/>
		</label>
		<p class="hint" id="password-rules">At least 10 characters. No other rules.</p>

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
