<script lang="ts">
	import { t } from '$lib/i18n';
	import { tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { resetUserMfa } from '$lib/api/adminUsers';
	import { user as me } from '$lib/auth';
	import ReauthFields from './ReauthFields.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import { resetError, resetLines, type MfaFactors } from './mfaResetView';
	import { reauthBody, reauthFocus, reauthNeedsCode, reauthReady } from './reauth';

	// Confirmation for resetting someone else's two-step sign-in: says what
	// goes and asks for the acting administrator's own password (and code,
	// when they have an authenticator). A modal Dialog (lib/ui) like the
	// delete dialog; the opener gets focus back through `onclose`.
	let {
		id,
		username,
		mfa,
		onclose,
		ongone
	}: {
		id: number;
		username: string;
		mfa: MfaFactors;
		onclose: (reset: boolean) => void;
		/** The account does not exist any more: the list should reload. */
		ongone: () => void;
	} = $props();

	const uid = $props.id();
	let sawCodeInvalid = $state(false);
	const needsCode = $derived(reauthNeedsCode($me?.mfa?.totp, sawCodeInvalid));
	let fields = $state<ReturnType<typeof ReauthFields> | null>(null);
	let password = $state('');
	let code = $state('');
	let busy = $state(false);
	let error = $state('');
	let closed = false;

	const ready = $derived(!busy && reauthReady(password, needsCode, code));

	function finish(reset: boolean): void {
		if (closed) return;
		closed = true;
		onclose(reset);
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!ready) return;
		busy = true;
		error = '';
		try {
			await resetUserMfa(id, reauthBody(password, needsCode, code));
			password = code = '';
			finish(true);
		} catch (err) {
			const kind = apiErrorBody(err)?.error;
			error = resetError(kind);
			if (kind === 'not_found') ongone();
			if (kind === 'code_invalid') sawCodeInvalid = true;
			const f = reauthFocus(kind);
			if (f.clear === 'code') code = '';
			if (f.clear === 'password') password = '';
			busy = false;
			await tick();
			fields?.focusField(f.focus);
		}
	}
</script>

<Dialog
	open
	title={t('admin.mfaReset.title', { name: username })}
	describedBy="{uid}-what"
	initialFocus="input[type='password']"
	dismissible={!busy}
	onclose={() => finish(false)}
>
	<form id="{uid}-form" onsubmit={submit}>
		<ul id="{uid}-what">
			{#each resetLines(mfa) as line (line)}<li>{line}</li>{/each}
		</ul>
		<ReauthFields bind:this={fields} bind:password bind:code {needsCode} />
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</form>
	{#snippet actions()}
		<Button onclick={() => finish(false)} disabled={busy}>{t('common.action.cancel')}</Button>
		<Button type="submit" form="{uid}-form" tone="danger" disabled={!ready} {busy}>{t('admin.mfaReset.submit')}</Button>
	{/snippet}
</Dialog>

<style>
	.error {
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
