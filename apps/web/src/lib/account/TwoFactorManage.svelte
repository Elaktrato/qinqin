<script lang="ts">
	import { apiErrorBody } from '$lib/api/client';
	import type { AuthOptions } from '$lib/api/account';
	import { newRecoveryCodes, setEmailMethod, totpDisable } from '$lib/api/mfa';
	import { loadMe, user } from '$lib/auth';
	import { recoveryWarning, stateSentence, twoFactorChoices } from './mfaView';
	import RecoveryCodes from './RecoveryCodes.svelte';
	import TwoFactorSetup from './TwoFactorSetup.svelte';

	// Settings, Account: the two-factor state and its changes.
	let { options }: { options: AuthOptions | null } = $props();

	type Action = 'none' | 'setup' | 'disable' | 'regen' | 'emailOff';
	let action = $state<Action>('none');
	let password = $state('');
	let code = $state('');
	let error = $state('');
	let busy = $state(false);
	let fresh = $state<string[] | null>(null);

	const mfa = $derived($user?.mfa);
	const choices = $derived(twoFactorChoices(options));
	const warning = $derived(recoveryWarning(mfa));
	const nothingToOffer = $derived(!choices.totp && !choices.email && !mfa?.totp && !mfa?.email);

	function open(next: Action) {
		action = next;
		password = code = error = '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			if (action === 'disable') await totpDisable(password, code);
			else if (action === 'regen') fresh = (await newRecoveryCodes(password, code)).recoveryCodes;
			else if (action === 'emailOff') await setEmailMethod(false, password);
			action = 'none';
			await loadMe();
		} catch (err) {
			const body = apiErrorBody(err);
			error =
				body?.error === 'wrong_password'
					? 'The password is wrong.'
					: body?.error === 'code_invalid'
						? 'That code is not right.'
						: body?.message || 'That did not work.';
		} finally {
			busy = false;
		}
	}
</script>

<section aria-labelledby="account-2fa-heading" class="block">
	<h2 id="account-2fa-heading">Two-step sign-in</h2>
	<p>{stateSentence(mfa)}</p>
	{#if warning}<p class="error" role="status">{warning}</p>{/if}
	{#if nothingToOffer && options}
		<p class="hint">{choices.totpWhy} {choices.emailWhy}</p>
	{/if}
	{#if fresh}
		<RecoveryCodes codes={fresh} site={location.host} oncontinue={() => (fresh = null)} />
	{:else if action === 'setup'}
		<TwoFactorSetup {options} onfinished={() => open('none')} />
	{:else if action === 'disable' || action === 'regen' || action === 'emailOff'}
		<form onsubmit={submit} class="stack">
			<label>
				Your password
				<input type="password" autocomplete="current-password" bind:value={password} required />
			</label>
			{#if action !== 'emailOff'}
				<label>
					Code from your app, or a recovery code
					<input name="code" autocomplete="one-time-code" bind:value={code} required />
				</label>
			{/if}
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<div class="actions">
				<button type="submit" disabled={busy}>
					{action === 'disable' ? 'Turn off the authenticator app' : action === 'regen' ? 'Make new recovery codes' : 'Turn off email codes'}
				</button>
				<button type="button" onclick={() => open('none')}>Cancel</button>
			</div>
		</form>
	{:else}
		<div class="actions">
			{#if (choices.totp || choices.email) && !mfa?.totp}
				<button type="button" onclick={() => open('setup')}>Set up two-step sign-in</button>
			{/if}
			{#if mfa?.totp}
				<button type="button" onclick={() => open('regen')}>New recovery codes</button>
				<button type="button" onclick={() => open('disable')}>Turn off the authenticator app</button>
			{/if}
			{#if mfa?.email}
				<button type="button" onclick={() => open('emailOff')}>Turn off email codes</button>
			{:else if mfa?.totp && choices.email && $user?.emailVerified}
				<button type="button" onclick={() => open('setup')}>Add email codes</button>
			{/if}
		</div>
	{/if}
</section>
