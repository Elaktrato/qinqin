<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { downloadMyData } from '$lib/api/backup';
	import { accountDeletionPreview, deleteAccount, type SelfDeletionPreview } from '$lib/api/account';
	import { apiErrorBody } from '$lib/api/client';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { user } from '$lib/auth';
	import { previewLines } from '$lib/admin/deleteView';

	// Deleting your own account: what goes (the server's counts), your
	// password, and your username typed. The last administrator is refused
	// by the server and the sentence says what to do first.
	let { username, ondone, onclose }: { username: string; ondone: () => void; onclose: () => void } = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);
	let password = $state('');
	let typed = $state('');
	let code = $state('');
	let preview = $state<SelfDeletionPreview | null>(null);
	let busy = $state(false);
	let error = $state('');
	let closed = false;

	const ready = $derived(typed === username && password !== '' && !busy);

	function finish(): void {
		if (closed) return;
		closed = true;
		if (dialog?.open) dialog.close();
		onclose();
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!ready) return;
		busy = true;
		error = '';
		try {
			await deleteAccount(password, typed, code.trim() || undefined);
			closed = true;
			ondone();
		} catch (err) {
			error =
				apiErrorBody(err)?.error === 'last_admin'
					? t('settings.account.delete.lastAdmin')
					: errorText(err, t('settings.account.delete.error'));
			busy = false;
			await tick();
			input?.focus();
		}
	}

	onMount(() => {
		if (typeof dialog?.showModal === 'function') dialog.showModal();
		else dialog?.setAttribute('open', '');
		input?.focus();
		accountDeletionPreview().then(
			(p) => (preview = p),
			() => undefined
		);
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	aria-describedby="{uid}-what"
	oncancel={(event) => {
		event.preventDefault();
		if (!busy) finish();
	}}
	onclose={finish}
>
	<form onsubmit={submit}>
		<h2 id="{uid}-title">{t('settings.account.delete.dialogTitle')}</h2>
		<div id="{uid}-what">
			<p>{t('settings.account.delete.what')}</p>
			{#if preview}
				<ul>
					{#each previewLines(preview) as line (line)}<li>{line}</li>{/each}
				</ul>
			{:else}
				<p role="status">{t('settings.account.delete.counting')}</p>
			{/if}
			<p>
				<Msg key="settings.account.delete.cannotUndo"
					>{#snippet download(text: string)}<button
							type="button"
							onclick={() => void downloadMyData().catch(() => (error = t('settings.account.delete.downloadFailed')))}
							>{text}</button
						>{/snippet}</Msg
				>
			</p>
		</div>
		<label>
			{t('account.field.yourPassword')}
			<input bind:this={input} type="password" autocomplete="current-password" bind:value={password} />
		</label>
		<label>
			<span
				><Msg key="settings.account.delete.typeToConfirm" args={{ name: username }}
					>{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg
				></span
			>
			<input bind:value={typed} autocomplete="off" />
		</label>
		{#if $user?.mfa?.totp}
			<label>
				{t('settings.account.email.code')}
				<input name="code" autocomplete="one-time-code" bind:value={code} />
			</label>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="buttons">
			<button type="button" onclick={finish} disabled={busy}>{t('common.action.cancel')}</button>
			<button type="submit" class="danger" disabled={!ready}>{busy ? t('settings.account.delete.deleting') : t('settings.account.delete.submit')}</button>
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
