<script lang="ts">
	// "Your note" on the entry page: one plain-text note per entry in the
	// current workspace. Rendered with text interpolation only, never as HTML.
	import { tick } from 'svelte';
	import type { Note } from './notes';
	import { canSave, counterText, isOverCap, type NoteView } from './noteEditor';
	import { deleteNote, loadNote, saveNote } from './store';

	let { workspaceId, entryId }: { workspaceId: number | null; entryId: number } = $props();

	let view = $state<NoteView>('loading');
	let note = $state<Note | null>(null);
	let draft = $state('');
	let busy = $state(false);
	let actionError = $state('');
	let textarea = $state<HTMLTextAreaElement | null>(null);
	let seq = 0;

	async function load(ws: number, id: number): Promise<void> {
		const mine = ++seq;
		view = 'loading';
		actionError = '';
		try {
			const n = await loadNote(ws, id);
			if (mine !== seq) return;
			note = n;
			view = n ? 'show' : 'empty';
		} catch {
			if (mine === seq) view = 'error';
		}
	}

	$effect(() => {
		if (workspaceId !== null) void load(workspaceId, entryId);
	});

	async function startEdit(): Promise<void> {
		draft = note?.text ?? '';
		actionError = '';
		view = 'edit';
		await tick();
		textarea?.focus();
	}

	function cancel(): void {
		actionError = '';
		view = note ? 'show' : 'empty';
	}

	async function save(): Promise<void> {
		if (workspaceId === null || busy || !canSave(draft, note?.text ?? null)) return;
		busy = true;
		actionError = '';
		try {
			note = await saveNote(workspaceId, entryId, draft, note);
			view = note ? 'show' : 'empty';
		} catch {
			actionError = 'Could not save your note. Your text is still here; try again.';
		} finally {
			busy = false;
		}
	}

	async function remove(): Promise<void> {
		if (workspaceId === null || busy) return;
		busy = true;
		actionError = '';
		try {
			await deleteNote(workspaceId, entryId);
			note = null;
			view = 'empty';
		} catch {
			actionError = 'Could not delete your note. Try again.';
		} finally {
			busy = false;
		}
	}

	function onKey(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		}
	}
</script>

{#if workspaceId !== null}
	<section class="entry-note" aria-labelledby="entry-note-heading">
		<h2 id="entry-note-heading">Your note</h2>
		{#if view === 'loading'}
			<p class="hint">Loading your note…</p>
		{:else if view === 'error'}
			<p class="hint">Your note could not be loaded.</p>
			<button type="button" onclick={() => workspaceId !== null && load(workspaceId, entryId)}>Try again</button>
		{:else if view === 'empty'}
			<button type="button" onclick={startEdit}>Add a note</button>
		{:else if view === 'edit'}
			<textarea
				bind:this={textarea}
				bind:value={draft}
				aria-label="Your note"
				aria-describedby="entry-note-counter"
				rows="4"
				onkeydown={onKey}
			></textarea>
			<p id="entry-note-counter" class="counter" class:over={isOverCap(draft)}>{counterText(draft)}</p>
			<div class="buttons">
				<button type="button" onclick={save} disabled={busy || !canSave(draft, note?.text ?? null)}>Save</button>
				<button type="button" onclick={cancel} disabled={busy}>Cancel</button>
			</div>
		{:else if note}
			<p class="note-text" data-testid="note-text">{note.text}</p>
			{#if view === 'confirmDelete'}
				<p class="confirm">Delete this note?</p>
				<div class="buttons">
					<button type="button" onclick={remove} disabled={busy}>Delete</button>
					<button type="button" onclick={() => (view = 'show')} disabled={busy}>Keep</button>
				</div>
			{:else}
				<div class="buttons">
					<button type="button" aria-label="Edit note" onclick={startEdit}>Edit</button>
					<button type="button" aria-label="Delete note" onclick={() => (view = 'confirmDelete')}>Delete</button>
				</div>
			{/if}
		{/if}
		{#if actionError}
			<p class="error" role="alert">{actionError}</p>
		{/if}
	</section>
{/if}

<style>
	.entry-note {
		margin-top: 1.5rem;
	}
	.note-text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		margin: 0 0 0.5rem;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		padding: 0.5rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}
	.counter {
		margin: 0.25rem 0;
		font-size: 0.85rem;
		opacity: 0.75;
	}
	.counter.over {
		color: #c62828;
		opacity: 1;
	}
	.buttons {
		display: flex;
		gap: 0.5rem;
	}
	button {
		font: inherit;
		padding: 0.45rem 0.85rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.hint {
		opacity: 0.75;
	}
	.error {
		color: #c62828;
		font-weight: 600;
	}
</style>
