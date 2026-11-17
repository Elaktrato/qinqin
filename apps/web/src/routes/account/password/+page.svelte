<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { api, apiErrorBody } from '$lib/api/client';
	import { confirmProblem, passwordHint, passwordProblem } from '$lib/account/passwordRules';
	import { get } from 'svelte/store';
	import { loadMe, user } from '$lib/auth';
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';

	let current = $state('');
	let next = $state('');
	let confirm = $state('');
	let error = $state('');
	// Ask for it up front when `me` says this session must give it.
	let needCurrent = $state(get(user)?.needsCurrentPassword ?? false);
	let busy = $state(false);
	let heading: HTMLHeadingElement | undefined = $state();

	onMount(() => heading?.focus());

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		error = '';
		const problem =
			passwordProblem($user?.username ?? '', next) ?? confirmProblem(next, confirm) ??
			(confirm === '' ? t('auth.forced.repeatMissing') : null);
		if (problem) {
			error = problem;
			return;
		}
		busy = true;
		try {
			await api('/api/account/password', {
				method: 'POST',
				body: {
					newPassword: next,
					signOutOthers: true,
					...(needCurrent ? { currentPassword: current } : {})
				}
			});
			// The session is a full one now; the layout guard lets it in.
			await loadMe();
			await goto('/', { replaceState: true });
		} catch (err) {
			const body = apiErrorBody(err);
			if (body?.error === 'wrong_password' || body?.error === 'current_password_required') {
				// The session predates the forced change: the server wants the
				// current password as well.
				error =
					needCurrent && body.error === 'wrong_password'
						? t('auth.forced.currentWrong')
						: t('auth.forced.currentNeeded');
				needCurrent = true;
			} else {
				error = body?.message || (err instanceof Error ? err.message : '') || t('auth.forced.failed');
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(t('auth.forced.passwordTitle'))}</title>
</svelte:head>

<main class="auth">
	<h1 tabindex="-1" bind:this={heading}>{t('auth.forced.passwordTitle')}</h1>
	<p>{t('auth.forced.passwordIntro')}</p>

	<form onsubmit={submit}>
		{#if needCurrent}
			<label>
				{t('auth.forced.current')}
				<input
					name="current"
					type="password"
					autocomplete="current-password"
					bind:value={current}
					required
				/>
			</label>
		{/if}

		<label>
			{t('auth.reset.newPassword')}
			<input
				name="new"
				type="password"
				autocomplete="new-password"
				aria-describedby="password-rules"
				bind:value={next}
				required
			/>
		</label>
		<p class="hint" id="password-rules">{passwordHint()}</p>

		<label>
			{t('auth.reset.repeat')}
			<input name="confirm" type="password" autocomplete="new-password" bind:value={confirm} required />
		</label>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		<button type="submit" disabled={busy}>{busy ? t('auth.forced.changing') : t('auth.forced.submit')}</button>
	</form>
</main>
