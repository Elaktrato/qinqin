<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { apiErrorBody } from '$lib/api/client';
	import type { AuthOptions } from '$lib/api/account';
	import { newRecoveryCodes, setEmailMethod, totpDisable } from '$lib/api/mfa';
	import { t } from '$lib/i18n';
	import { recoveryWarning, stateSentence, twoFactorChoices } from './mfaView';
	import RecoveryCodes from './RecoveryCodes.svelte';
	import TwoFactorSetup from './TwoFactorSetup.svelte';
	import { Button, Field, Section } from '$lib/ui';
	import { useApp } from '$lib/context/context';
	const app = useApp();

	// Settings, Account: the two-factor state and its changes.
	let { options }: { options: AuthOptions | null } = $props();

	type Action = 'none' | 'setup' | 'disable' | 'regen' | 'emailOff';
	let action = $state<Action>('none');
	let password = $state('');
	let code = $state('');
	let error = $state('');
	let busy = $state(false);
	let fresh = $state<string[] | null>(null);

	const mfa = $derived(app.auth.user?.mfa);
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
			await app.auth.loadMe();
		} catch (err) {
			const body = apiErrorBody(err);
			error =
				body?.error === 'wrong_password'
					? t('account.mfa.wrongPassword')
					: body?.error === 'code_invalid'
						? t('account.mfa.codeWrong')
						: errorText(err, t('account.mfa.failed'));
		} finally {
			busy = false;
		}
	}
</script>

<Section title={t('account.mfa.title')}>
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
			<Field
				label={t('account.field.yourPassword')}
				type="password"
				autocomplete="current-password"
				bind:value={password}
				required
			/>
			{#if action !== 'emailOff'}
				<label>
					{t('account.mfa.codeOrRecovery')}
					<input name="code" autocomplete="one-time-code" bind:value={code} required />
				</label>
			{/if}
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<div class="actions">
				<Button type="submit" variant="primary" tone="danger" disabled={busy}>
					{action === 'disable' ? t('account.mfa.turnOffApp') : action === 'regen' ? t('account.mfa.makeRecovery') : t('account.mfa.turnOffEmail')}
				</Button>
				<Button onclick={() => open('none')}>{t('common.action.cancel')}</Button>
			</div>
		</form>
	{:else}
		<div class="actions">
			{#if (choices.totp || choices.email) && !mfa?.totp}
				<Button onclick={() => open('setup')}>{t('account.mfa.setUp')}</Button>
			{/if}
			{#if mfa?.totp}
				<Button onclick={() => open('regen')}>{t('account.mfa.newRecovery')}</Button>
				<Button tone="danger" onclick={() => open('disable')}>{t('account.mfa.turnOffApp')}</Button>
			{/if}
			{#if mfa?.email}
				<Button tone="danger" onclick={() => open('emailOff')}>{t('account.mfa.turnOffEmail')}</Button>
			{:else if mfa?.totp && choices.email && app.auth.user?.emailVerified}
				<Button onclick={() => open('setup')}>{t('account.mfa.addEmail')}</Button>
			{/if}
		</div>
	{/if}
</Section>
