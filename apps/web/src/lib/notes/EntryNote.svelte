<script lang="ts">
	// "Your note" on the entry page: one plain-text note per entry in the
	// current workspace. Rendered with text interpolation only, never as HTML.
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
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
			actionError = t('notes.saveFailed');
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
			actionError = t('notes.deleteFailed');
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
		<h2 id="entry-note-heading">{t('notes.title')}</h2>
		{#if view === 'loading'}
			<p class="hint">{t('notes.loading')}</p>
		{:else if view === 'error'}
			<p class="hint">{t('notes.loadFailed')}</p>
			<button type="button" onclick={() => workspaceId !== null && load(workspaceId, entryId)}>{t('common.action.retry')}</button>
		{:else if view === 'empty'}
			<button type="button" onclick={startEdit}>{t('notes.add')}</button>
		{:else if view === 'edit'}
			<textarea
				bind:this={textarea}
				bind:value={draft}
				aria-label={t('notes.title')}
				aria-describedby="entry-note-counter"
				rows="4"
				onkeydown={onKey}
			></textarea>
			<p id="entry-note-counter" class="counter" class:over={isOverCap(draft)}>{counterText(draft)}</p>
			<div class="buttons">
				<button type="button" onclick={save} disabled={busy || !canSave(draft, note?.text ?? null)}>{t('common.action.save')}</button>
				<button type="button" onclick={cancel} disabled={busy}>{t('common.action.cancel')}</button>
			</div>
		{:else if note}
			<p class="note-text" data-testid="note-text">{note.text}</p>
			{#if view === 'confirmDelete'}
				<p class="confirm">{t('notes.confirmDelete')}</p>
				<div class="buttons">
					<button type="button" onclick={remove} disabled={busy}>{t('common.action.delete')}</button>
					<button type="button" onclick={() => (view = 'show')} disabled={busy}>{t('notes.keep')}</button>
				</div>
			{:else}
				<div class="buttons">
					<button type="button" aria-label={t('notes.edit')} onclick={startEdit}>{t('notes.editShort')}</button>
					<button type="button" aria-label={t('notes.delete')} onclick={() => (view = 'confirmDelete')}>{t('common.action.delete')}</button>
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
		color: var(--readable-muted);
	}
	.counter.over {
		color: var(--readable-bad);
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
		color: var(--readable-muted);
	}
	.error {
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
