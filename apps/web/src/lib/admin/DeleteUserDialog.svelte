<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { onMount, tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { deleteUser, deletionPreview, type DeletionPreview } from '$lib/api/adminUsers';
	import { previewLines } from './deleteView';
	import { user as me } from '$lib/auth';
	import ReauthFields from './ReauthFields.svelte';
	import { reauthBody, reauthError, reauthFocus, reauthNeedsCode, reauthReady } from './reauth';

	// Confirmation for deleting someone else's account: says exactly what
	// goes (the server's own counts) and asks for the username to be typed.
	// A modal <dialog>: the browser traps focus and closes it on Escape; the
	// opener gets focus back through `onclose`.
	let {
		id,
		username,
		onclose
	}: { id: number; username: string; onclose: (deleted: boolean) => void } = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);
	let typed = $state('');
	let password = $state('');
	let code = $state('');
	let sawCodeInvalid = $state(false);
	const needsCode = $derived(reauthNeedsCode($me?.mfa?.totp, sawCodeInvalid));
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
		if (dialog?.open) {
			if (typeof dialog.close === 'function') dialog.close();
			else dialog.removeAttribute('open');
		}
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
		if (typeof dialog?.showModal === 'function') dialog.showModal();
		else dialog?.setAttribute('open', '');
		input?.focus();
		deletionPreview(id).then(
			(p) => (preview = p),
			() => (previewFailed = true)
		);
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	aria-describedby="{uid}-what"
	oncancel={(event) => {
		event.preventDefault();
		if (!busy) finish(false);
	}}
	onclose={() => finish(false)}
>
	<form onsubmit={submit}>
		<h2 id="{uid}-title">{t('admin.delete.title', { name: username })}</h2>
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
		<label>
			<Msg key="admin.delete.typeToConfirm" args={{ name: username }}
				>{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg
			>
			<input bind:this={input} bind:value={typed} autocomplete="off" />
		</label>
		<ReauthFields bind:this={fields} bind:password bind:code {needsCode} />
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="buttons">
			<button type="button" onclick={() => finish(false)} disabled={busy}>{t('common.action.cancel')}</button>
			<button type="submit" class="danger" disabled={!ready}>{busy ? t('admin.delete.deleting') : t('admin.delete.submit')}</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		max-width: min(34rem, calc(100vw - 2rem));
		padding: 1.2rem;
	}
	label {
		display: grid;
		gap: 0.3rem;
		margin-top: 0.8rem;
	}
	input {
		font: inherit;
		padding: 0.45rem 0.6rem;
	}
	.buttons {
		display: flex;
		gap: 0.6rem;
		justify-content: flex-end;
		margin-top: 1rem;
	}
	.error {
		color: #c62828;
		font-weight: 600;
	}
	.danger {
		background: #b3261e;
		border-color: #b3261e;
		color: #fff;
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
