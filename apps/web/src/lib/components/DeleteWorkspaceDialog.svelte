<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { ApiError } from '$lib/api/client';
	import type { Workspace } from '$lib/api/types';
	import { fetchWorkspaceContents, type WorkspaceContents } from '$lib/api/workspaceContents';
	import { confirmLabel, labelMatches } from '$lib/workspaceDelete';
	import { deleteWorkspace } from '$lib/workspaces';

	// The confirmation for deleting a workspace: a modal <dialog> (the
	// browser traps focus in it, makes the page behind inert and closes it
	// on Escape) that says what goes and asks for the workspace's label to
	// be typed. The opener gets focus back through `onclose`.
	let {
		workspace,
		list,
		onclose
	}: {
		workspace: Workspace;
		list: readonly Workspace[];
		/** `deleted`: the workspace is gone, focus cannot return to its row. */
		onclose: (deleted: boolean) => void;
	} = $props();

	const uid = $props.id();
	const label = $derived(confirmLabel(list, workspace));

	let dialog = $state<HTMLDialogElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);
	let typed = $state('');
	let contents = $state<WorkspaceContents | null>(null);
	let contentsFailed = $state(false);
	let deleting = $state(false);
	let error = $state('');
	let closed = false;

	const ready = $derived(labelMatches(typed, label) && !deleting);

	function plural(n: number, one: string, many: string): string {
		return `${n} ${n === 1 ? one : many}`;
	}

	function finish(deleted: boolean): void {
		if (closed) return;
		closed = true;
		if (dialog?.open) dialog.close();
		onclose(deleted);
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!ready) return;
		deleting = true;
		error = '';
		try {
			await deleteWorkspace(workspace.id);
			finish(true);
		} catch (err) {
			error =
				err instanceof ApiError && err.status === 409
					? 'This is your only workspace, so it cannot be deleted.'
					: err instanceof Error && err.message
						? err.message
						: 'Could not delete the workspace.';
			deleting = false;
			await tick();
			input?.focus();
		}
	}

	onMount(() => {
		dialog?.showModal();
		input?.focus();
		let alive = true;
		fetchWorkspaceContents(workspace.id).then(
			(found) => {
				if (alive) contents = found;
			},
			() => {
				if (alive) contentsFailed = true;
			}
		);
		return () => {
			alive = false;
		};
	});
</script>

<dialog
	bind:this={dialog}
	class="delete-dialog"
	aria-labelledby="{uid}-title"
	aria-describedby="{uid}-what"
	oncancel={(event) => {
		// Escape: close through our own path so the opener gets focus back.
		event.preventDefault();
		if (!deleting) finish(false);
	}}
>
	<form onsubmit={submit}>
		<h2 id="{uid}-title">Delete the workspace “{label}”?</h2>
		<div id="{uid}-what">
			<p>This permanently deletes, on every device:</p>
			<ul>
				{#if contents}
					<li>{plural(contents.books, 'book', 'books')} in its library, with their bookmarks and highlights</li>
					<li>
						{plural(contents.cards, 'flashcard', 'flashcards')}{contents.decks > 0
							? ` and ${plural(contents.decks, 'deck', 'decks')}`
							: ''}
					</li>
					<li>{plural(contents.reviews, 'recorded review', 'recorded reviews')} and the rest of its study history</li>
				{:else}
					<li>its library books, with their bookmarks and highlights</li>
					<li>its flashcards and decks</li>
					<li>its reviews and the rest of its study history</li>
				{/if}
			</ul>
			{#if !contents && !contentsFailed}
				<p class="hint" aria-live="polite">Counting…</p>
			{/if}
			<p>Your other workspaces are not touched. This cannot be undone.</p>
		</div>

		<label for="{uid}-confirm">Type <strong>{label}</strong> to confirm</label>
		<input
			bind:this={input}
			bind:value={typed}
			id="{uid}-confirm"
			autocomplete="off"
			spellcheck="false"
			aria-invalid={error ? 'true' : undefined}
		/>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		<div class="actions">
			<button type="button" class="secondary" onclick={() => finish(false)} disabled={deleting}>Cancel</button>
			<button type="submit" class="danger" disabled={!ready} aria-busy={deleting}>
				{deleting ? 'Deleting…' : 'Delete workspace'}
			</button>
		</div>
	</form>
</dialog>

<style>
	.delete-dialog {
		max-width: min(32rem, calc(100vw - 2rem));
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.5rem;
		padding: 1.25rem;
		background: Canvas;
		color: CanvasText;
	}

	.delete-dialog::backdrop {
		background: rgb(0 0 0 / 0.45);
	}

	h2 {
		margin: 0 0 0.75rem;
		font-size: 1.2rem;
		overflow-wrap: anywhere;
	}

	ul {
		margin: 0.25rem 0 0.75rem;
		padding-left: 1.25rem;
	}

	.hint {
		opacity: 0.75;
		margin: 0 0 0.5rem;
	}

	label {
		display: block;
		margin: 0.75rem 0 0.35rem;
		overflow-wrap: anywhere;
	}

	input {
		box-sizing: border-box;
		width: 100%;
		font: inherit;
		padding: 0.4rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	button {
		font: inherit;
		padding: 0.45rem 0.85rem;
		border-radius: 0.4rem;
		font-weight: 600;
		cursor: pointer;
	}

	button.secondary {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
		font-weight: 500;
	}

	button.danger {
		border: 0;
		background: #c62828;
		color: #fff;
	}

	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.error {
		margin: 0.5rem 0 0;
		color: #c62828;
		font-weight: 600;
	}
</style>
