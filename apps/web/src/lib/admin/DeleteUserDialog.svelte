<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { Field } from '$lib/ui';
	import Msg from '$lib/i18n/Msg.svelte';
	import { onMount, tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { deleteUser, deletionPreview, type DeletionPreview } from '$lib/api/adminUsers';
	import { previewLines } from './deleteView';
	import ReauthFields from './ReauthFields.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import { reauthBody, reauthError, reauthFocus, reauthNeedsCode, reauthReady } from './reauth';
	import { useApp } from '$lib/context/context';
	const app = useApp();

	// Confirmation for deleting someone else's account: says exactly what
	// goes (the server's own counts) and asks for the username to be typed.
	// A modal Dialog (lib/ui): focus is trapped and Escape closes it (not
	// while deleting); the opener gets focus back through `onclose`.
	let {
		id,
		username,
		onclose
	}: { id: number; username: string; onclose: (deleted: boolean) => void } = $props();

	const uid = $props.id();
	let input = $state<HTMLInputElement | undefined>(undefined);
	let typed = $state('');
	let password = $state('');
	let code = $state('');
	let sawCodeInvalid = $state(false);
	const needsCode = $derived(reauthNeedsCode(app.auth.user?.mfa?.totp, sawCodeInvalid));
	let fields = $state<ReturnType<typeof ReauthFields> | null>(null);
	let preview = $state<DeletionPreview | null>(null);
	let previewFailed = $state(false);
	let busy = $state(false);
	let error = $state('');
	let closed = false;

	const ready = $derived(typed === username && reauthReady(password, needsCode, code) && !busy);

	function finish(deleted: boolean): void {
		if (closed) return;
		closed = true;
		onclose(deleted);
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!ready) return;
		busy = true;
		error = '';
		try {
			await deleteUser(id, typed, reauthBody(password, needsCode, code));
			finish(true);
		} catch (err) {
			const b = apiErrorBody(err);
			error = reauthError(b?.error, errorText(err, t('admin.delete.error')));
			busy = false;
			if (b?.error === 'code_invalid') sawCodeInvalid = true;
			const f = reauthFocus(b?.error);
			if (f.clear === 'code') code = '';
			if (f.clear === 'password') password = '';
			await tick();
			if (f.clear || b?.error === 'password_required') fields?.focusField(f.focus);
			else input?.focus();
		}
	}

	onMount(() => {
		deletionPreview(id).then(
			(p) => (preview = p),
			() => (previewFailed = true)
		);
	});
</script>

<Dialog
	open
	title={t('admin.delete.title', { name: username })}
	describedBy="{uid}-what"
	initialFocus="input"
	dismissible={!busy}
	onclose={() => finish(false)}
>
	<form id="{uid}-form" onsubmit={submit}>
		<div id="{uid}-what">
			<p>{t('admin.delete.what')}</p>
			{#if preview}
				<ul>
					{#each previewLines(preview) as line (line)}<li>{line}</li>{/each}
				</ul>
			{:else if previewFailed}
				<p>{t('admin.delete.previewFailed')}</p>
			{:else}
				<p role="status">{t('admin.delete.counting')}</p>
			{/if}
			<p>{t('admin.delete.cannotUndo')}</p>
		</div>
		<Field
			label={t('admin.delete.typeToConfirm', { name: username }).replace(/<[^>]+>/g, '')}
			bind:element={input}
			bind:value={typed}
			autocomplete="off"
		/>
		<ReauthFields bind:this={fields} bind:password bind:code {needsCode} />
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</form>
	{#snippet actions()}
		<Button onclick={() => finish(false)} disabled={busy}>{t('common.action.cancel')}</Button>
		<Button type="submit" form="{uid}-form" variant="primary" tone="danger" disabled={!ready} {busy}
			>{busy ? t('admin.delete.deleting') : t('admin.delete.submit')}</Button
		>
	{/snippet}
</Dialog>

<style>
	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
