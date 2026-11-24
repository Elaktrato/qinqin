<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Button from '$lib/ui/Button.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Field from '$lib/ui/Field.svelte';
	import { downloadMyData } from '$lib/api/backup';
	import { accountDeletionPreview, deleteAccount, type SelfDeletionPreview } from '$lib/api/account';
	import { apiErrorBody } from '$lib/api/client';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { previewLines } from '$lib/admin/deleteView';
	import { useApp } from '$lib/context/context';
	const app = useApp();

	// Deleting your own account: what goes (the server's counts), your
	// password, and your username typed. The last administrator is refused
	// by the server and the sentence says what to do first.
	let { username, ondone, onclose }: { username: string; ondone: () => void; onclose: () => void } = $props();

	const uid = $props.id();
	let input = $state<HTMLInputElement | undefined>(undefined);
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
		accountDeletionPreview().then(
			(p) => (preview = p),
			() => undefined
		);
	});
</script>

<Dialog
	open
	title={t('settings.account.delete.dialogTitle')}
	describedBy="{uid}-what"
	initialFocus="input[type='password']"
	dismissible={!busy}
	onclose={finish}
>
	<form id="{uid}-form" onsubmit={submit}>
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
					>{#snippet download(text: string)}<Button
							variant="plain"
							onclick={() => void downloadMyData().catch(() => (error = t('settings.account.delete.downloadFailed')))}
							>{text}</Button
						>{/snippet}</Msg
				>
			</p>
		</div>
		<Field
			label={t('account.field.yourPassword')}
			type="password"
			autocomplete="current-password"
			bind:element={input}
			bind:value={password}
		/>
		<Field
			label={t('settings.account.delete.typeToConfirm', { name: username }).replace(/<[^>]+>/g, '')}
			bind:value={typed}
			autocomplete="off"
		/>
		{#if app.auth.user?.mfa?.totp}
			<label>
				{t('settings.account.email.code')}
				<input name="code" autocomplete="one-time-code" bind:value={code} />
			</label>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</form>
	{#snippet actions()}
		<Button onclick={finish} disabled={busy}>{t('common.action.cancel')}</Button>
		<Button type="submit" form="{uid}-form" variant="primary" tone="danger" disabled={!ready} {busy}
			>{busy ? t('settings.account.delete.deleting') : t('settings.account.delete.submit')}</Button
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
