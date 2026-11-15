<script lang="ts">
	import { onMount } from 'svelte';
	import { pageTitle } from '$lib/pageTitle';
	import { authErrorMessage } from '$lib/api/authErrors';
	import { checkInvite, getAuthOptions, type AuthOptions } from '$lib/api/account';
	import { readFragment } from '$lib/account/fragment';
	import { register } from '$lib/auth';

	let username = $state('');
	let password = $state('');
	let email = $state('');
	let error = $state('');
	let busy = $state(false);
	let loaded = $state(false);
	let options = $state<AuthOptions | null>(null);
	let invite = $state('');
	let inviteProblem = $state('');
	let emailPolicy = $state<AuthOptions['emailPolicy']>('off');

	onMount(async () => {
		// The invite token lives in the fragment: read it once, then take it out
		// of the address bar and history.
		const read = readFragment(location.hash, 'invite', location.pathname + location.search);
		if (read.value) history.replaceState(null, '', read.cleaned);
		try {
			options = await getAuthOptions();
			emailPolicy = options.emailPolicy;
		} catch {
			// Without options the form is shown as before and the server decides.
		}
		if (read.value) {
			invite = read.value;
			try {
				const found = await checkInvite(invite);
				emailPolicy = found.emailPolicy;
			} catch (err) {
				inviteProblem = authErrorMessage(err, 'This invite link is no longer valid.');
			}
		}
		loaded = true;
	});

	// Who may see the form: the bootstrap, an invite holder, or anyone when open.
	const closed = $derived(
		loaded && options !== null && !options.bootstrap && !invite && options.registration !== 'open'
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;

		error = '';
		busy = true;
		try {
			await register(username.trim(), password, { email: email.trim(), invite });
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

	{#if !loaded}
		<p class="hint" role="status">Loading…</p>
	{:else if inviteProblem}
		<p class="error" role="alert">{inviteProblem}</p>
		<p class="hint">Ask the administrator for a new invite link. <a href="/login">Sign in</a></p>
	{:else if closed}
		<p role="status">
			{options?.registration === 'invite'
				? 'You need an invite link to register. Open the link you were given, or ask the administrator.'
				: 'Registration is closed. Ask the administrator for an invite link or an account.'}
		</p>
		<p class="hint"><a href="/login">Sign in</a></p>
	{:else}
		{#if options?.bootstrap}
			<p class="hint">This is a new instance: the first account becomes the administrator.</p>
		{/if}
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

			{#if emailPolicy !== 'off' && !options?.bootstrap}
				<label>
					{emailPolicy === 'required' ? 'Email' : 'Email (optional)'}
					<input
						name="email"
						type="email"
						autocomplete="email"
						bind:value={email}
						required={emailPolicy === 'required'}
					/>
				</label>
			{/if}

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

		<p class="hint">Already have an account? <a href="/login">Sign in</a>.</p>
	{/if}
</main>
