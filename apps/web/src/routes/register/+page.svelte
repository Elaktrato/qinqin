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
	import { Button, Field } from '$lib/ui';

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
				inviteProblem = authErrorMessage(err, t('auth.register.inviteInvalid'), 'register');
			}
		}
		loaded = true;
	});

	const emailLabel = $derived(
		emailPolicy === 'required' ? t('account.email.label') : t('account.email.labelOptional')
	);

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
			error = authErrorMessage(err, t('auth.register.failed'), 'register');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(t('auth.register.title'))}</title>
</svelte:head>

<div class="page-body auth">
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
			<Field
				label={t('auth.signIn.username')}
				name="username"
				autocomplete="username"
				hint={t('auth.register.usernameRules')}
				bind:value={username}
				required
			/>

			{#if emailPolicy !== 'off' && !options?.bootstrap}
				<Field
					label={emailLabel}
					name="email"
					type="email"
					autocomplete="email"
					bind:value={email}
					required={emailPolicy === 'required'}
				/>
			{/if}

			<Field
				label={t('account.field.password')}
				name="password"
				type="password"
				autocomplete="new-password"
				hint={passwordHint()}
				bind:value={password}
				required
			/>

			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			<Button type="submit" variant="primary" busy={busy}
				>{busy ? t('auth.register.creating') : t('auth.register.submit')}</Button
			>
		</form>

		<p class="hint">
			<Msg key="auth.register.haveAccount">{#snippet link(text: string)}<a href="/login">{text}</a>{/snippet}</Msg>
		</p>
	{/if}
</div>
