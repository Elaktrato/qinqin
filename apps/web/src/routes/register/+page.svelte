<script lang="ts">
	import { onMount } from 'svelte';
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { authErrorMessage } from '$lib/api/authErrors';
	import { checkInvite, getAuthOptions, type AuthOptions } from '$lib/api/account';
	import { readFragment } from '$lib/account/fragment';
	import { register } from '$lib/auth';
	import { passwordHint } from '$lib/account/passwordRules';

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
				inviteProblem = authErrorMessage(err, t('auth.register.inviteInvalid'));
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
			error = authErrorMessage(err, t('auth.register.failed'));
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(t('auth.register.title'))}</title>
</svelte:head>

<main class="auth">
	<h1>{t('auth.register.title')}</h1>

	{#if !loaded}
		<p class="hint" role="status">{t('app.loading')}</p>
	{:else if inviteProblem}
		<p class="error" role="alert">{inviteProblem}</p>
		<p class="hint">
			<Msg key="auth.register.askNewInvite">{#snippet link(text: string)}<a href="/login">{text}</a>{/snippet}</Msg>
		</p>
	{:else if closed}
		<p role="status">
			{options?.registration === 'invite'
				? t('auth.register.needInvite')
				: t('auth.register.closed')}
		</p>
		<p class="hint"><a href="/login">{t('auth.register.signIn')}</a></p>
	{:else}
		{#if options?.bootstrap}
			<p class="hint">{t('auth.register.bootstrap')}</p>
		{/if}
		<form onsubmit={submit}>
			<label>
				{t('auth.signIn.username')}
				<input
					name="username"
					autocomplete="username"
					aria-describedby="username-rules"
					bind:value={username}
					required
				/>
			</label>
			<p class="hint" id="username-rules">{t('auth.register.usernameRules')}</p>

			{#if emailPolicy !== 'off' && !options?.bootstrap}
				<label>
					{emailPolicy === 'required' ? t('account.email.label') : t('account.email.labelOptional')}
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
				{t('account.field.password')}
				<input
					name="password"
					type="password"
					autocomplete="new-password"
					aria-describedby="password-rules"
					bind:value={password}
					required
				/>
			</label>
			<p class="hint" id="password-rules">{passwordHint()}</p>

			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			<button type="submit" disabled={busy}>{busy ? t('auth.register.creating') : t('auth.register.submit')}</button>
		</form>

		<p class="hint">
			<Msg key="auth.register.haveAccount">{#snippet link(text: string)}<a href="/login">{text}</a>{/snippet}</Msg>
		</p>
	{/if}
</main>
