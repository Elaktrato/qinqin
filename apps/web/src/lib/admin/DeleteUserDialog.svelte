<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { deleteUser, deletionPreview, type DeletionPreview } from '$lib/api/adminUsers';
	import { previewLines } from './deleteView';

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
	let preview = $state<DeletionPreview | null>(null);
	let previewFailed = $state(false);
	let busy = $state(false);
	let error = $state('');
	let closed = false;

	const ready = $derived(typed === username && !busy);

	function finish(deleted: boolean): void {
		if (closed) return;
		closed = true;
		if (dialog?.open) dialog.close();
		onclose(deleted);
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!ready) return;
		busy = true;
		error = '';
		try {
			await deleteUser(id, typed);
			finish(true);
		} catch (err) {
			error = apiErrorBody(err)?.message || 'Could not delete the account.';
			busy = false;
			await tick();
			input?.focus();
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
		<h2 id="{uid}-title">Delete the account “{username}”?</h2>
		<div id="{uid}-what">
			<p>This permanently deletes the account and, on every device:</p>
			{#if preview}
				<ul>
					{#each previewLines(preview) as line (line)}<li>{line}</li>{/each}
				</ul>
			{:else if previewFailed}
				<p>All of their workspaces, study history, plugin data, library and AI keys.</p>
			{:else}
				<p role="status">Counting…</p>
			{/if}
			<p>This cannot be undone.</p>
		</div>
		<label>
			Type <strong>{username}</strong> to confirm
			<input bind:this={input} bind:value={typed} autocomplete="off" />
		</label>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="buttons">
			<button type="button" onclick={() => finish(false)} disabled={busy}>Cancel</button>
			<button type="submit" class="danger" disabled={!ready}>{busy ? 'Deleting…' : 'Delete account'}</button>
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
