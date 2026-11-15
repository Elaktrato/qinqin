<script lang="ts">
	import { untrack } from 'svelte';
	import { ApiError } from '$lib/api/client';
	import { getSharedEntry } from '$lib/api/entries';
	import { buildPatch, updateEntry, type EntryPatchReading } from '$lib/api/edit';
	import type { EntryDetail } from '$lib/api/types';

	interface ReadingRow extends EntryPatchReading {
		key: number;
	}

	let {
		entry,
		onSaved,
		onCancel
	}: {
		entry: EntryDetail;
		onSaved: (entry: EntryDetail) => void;
		onCancel: () => void;
	} = $props();

	// Stable keys let rows be removed without the inputs of the following
	// rows jumping to a different reading.
	let nextKey = 0;

	function toRows(source: EntryDetail): ReadingRow[] {
		return [...source.readings]
			.sort((a, b) => a.ord - b.ord)
			.map(({ type, value }) => ({ key: nextKey++, type, value }));
	}

	// The draft starts from the entry as loaded and is then owned locally;
	// the page remounts the editor when the entry id changes and save()
	// resyncs it from the PUT response.
	const initial = untrack(() => ({ written: entry.written, rows: toRows(entry) }));
	let written = $state(initial.written);
	let rows = $state<ReadingRow[]>(initial.rows);
	let saving = $state(false);
	let saved = $state('');
	let error = $state('');

	// PUT replaces the whole overlay and treats an omitted field as "no
	// overlay", so the patch is built against the *shared* entry: a field
	// that still carries the caller's overlay is sent even when the user
	// did not touch it in this session, and editing one field never clears
	// another. The shared entry is fetched without a token to keep it
	// unambiguous.
	let baseline = $state<EntryDetail | null>(null);
	let baselineError = $state('');
	// Bumped by "Try again" to re-run the baseline fetch below.
	let baselineAttempt = $state(0);

	// What is stored for the caller right now: the entry as loaded, then the
	// last PUT response. Save is for changes against this, not against the
	// shared entry, so a saved draft is clean and a revert is a change.
	let current = $state.raw(untrack(() => entry));

	$effect(() => {
		const id = entry.id;
		void baselineAttempt;
		if (baseline?.id === id) return;
		let cancelled = false;
		baseline = null;
		baselineError = '';
		getSharedEntry(id)
			.then((shared) => {
				if (!cancelled) baseline = shared;
			})
			.catch((err) => {
				if (!cancelled) baselineError = message(err, 'Could not prepare the editor.');
			});
		return () => {
			cancelled = true;
		};
	});

	const draft = $derived({
		written,
		readings: rows.map(({ type, value }) => ({ type, value }))
	});
	const patch = $derived(baseline === null ? {} : buildPatch(baseline, draft));
	// The patch that reproduces what is stored now; equal patches mean no change.
	const storedPatch = $derived(baseline === null ? {} : buildPatch(baseline, toDraft(current)));
	const hasChanges = $derived(
		baseline !== null && JSON.stringify(patch) !== JSON.stringify(storedPatch)
	);
	// Rows the server would refuse (400): both fields are required.
	const blankReading = $derived(
		rows.some((row) => row.type.trim() === '' || row.value.trim() === '')
	);
	// Anything the caller has (stored or in the draft) that differs from shared.
	const differsFromShared = $derived(Object.keys(patch).length > 0 || Object.keys(storedPatch).length > 0);

	function toDraft(source: EntryDetail) {
		return {
			written: source.written,
			readings: [...source.readings]
				.sort((a, b) => a.ord - b.ord)
				.map(({ type, value }) => ({ type, value }))
		};
	}

	// Reset every field to the shared entry. Saving then sends an empty patch,
	// which the server stores as "no overlay": the shared values show again.
	function revertToShared(): void {
		if (baseline === null) return;
		clearMessages();
		written = baseline.written;
		rows = toRows(baseline);
	}

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	function addRow(): void {
		clearMessages();
		rows = [...rows, { key: nextKey++, type: '', value: '' }];
	}

	function clearMessages(): void {
		saved = '';
		error = '';
	}

	function removeRow(key: number): void {
		clearMessages();
		rows = rows.filter((row) => row.key !== key);
	}

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (saving || baseline === null || !hasChanges || blankReading) return;

		saving = true;
		saved = '';
		error = '';
		try {
			const updated = await updateEntry(entry.id, patch);
			// The PUT response is the caller's refreshed view; keeping the
			// draft in sync with it also picks up any server-side ordering.
			written = updated.written;
			rows = toRows(updated);
			current = updated;
			saved = 'Saved.';
			onSaved(updated);
		} catch (err) {
			error = message(err, 'Could not save your changes.');
		} finally {
			saving = false;
		}
	}
</script>

<form class="editor" aria-label="Edit entry" onsubmit={save} oninput={clearMessages}>
	<h2>Edit entry</h2>

	{#if baselineError}
		<p class="error" role="alert">{baselineError}</p>
		<button type="button" class="retry" onclick={() => baselineAttempt++}>Try again</button>
	{:else if baseline === null}
		<p class="hint" aria-live="polite">Preparing editor…</p>
	{/if}

	<label class="written-field">
		<span>Written form</span>
		<input bind:value={written} name="written" autocomplete="off" required />
	</label>

	<fieldset class="readings">
		<legend>Readings</legend>
		{#if rows.length === 0}
			<p class="hint">No readings. Add one below to replace them.</p>
		{/if}
		<ul class="rows">
			{#each rows as row, index (row.key)}
				<li class="row">
					<input
						class="type"
						aria-label={`Reading ${index + 1} type`}
						placeholder="type"
						autocomplete="off"
						bind:value={row.type}
					/>
					<input
						class="value"
						aria-label={`Reading ${index + 1} value`}
						placeholder="value"
						autocomplete="off"
						bind:value={row.value}
					/>
					<button
						type="button"
						class="remove"
						aria-label={`Remove reading ${index + 1}`}
						onclick={() => removeRow(row.key)}
					>
						Remove
					</button>
				</li>
			{/each}
		</ul>
		<button type="button" class="add" onclick={addRow}>Add reading</button>
		{#if blankReading}
			<p class="hint" role="status">Every reading needs a type and a value.</p>
		{/if}
	</fieldset>

	<div class="actions">
		<button type="submit" class="save" disabled={saving || !hasChanges || blankReading}>
			{saving ? 'Saving…' : 'Save'}
		</button>
		{#if differsFromShared}
			<button type="button" class="revert" onclick={revertToShared} disabled={saving}>
				Revert to shared
			</button>
		{/if}
		<button type="button" class="cancel" onclick={onCancel} disabled={saving}>Cancel</button>
	</div>

	{#if saved}
		<p class="saved" role="status" aria-live="polite">{saved}</p>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</form>

<style>
	.editor {
		margin-top: 1.5rem;
		padding: 1rem;
		border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
		border-radius: 0.5rem;
	}

	.editor h2 {
		margin: 0 0 0.75rem;
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.written-field {
		display: grid;
		gap: 0.25rem;
		max-width: 20rem;
	}

	.written-field span,
	.readings legend {
		font-size: 0.8rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.written-field input,
	.row input {
		font: inherit;
		padding: 0.4rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}

	.readings {
		margin: 1rem 0 0;
		padding: 0;
		border: 0;
	}

	.readings legend {
		padding: 0;
		margin-bottom: 0.5rem;
	}

	.hint {
		margin: 0 0 0.5rem;
		opacity: 0.7;
	}

	.rows {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.4rem;
		max-width: 34rem;
	}

	.row {
		display: flex;
		gap: 0.4rem;
	}

	.row .type {
		flex: 0 1 9rem;
	}

	.row .value {
		flex: 1 1 auto;
		min-width: 0;
	}

	.add,
	.remove,
	.save,
	.revert,
	.retry,
	.cancel {
		font: inherit;
		font-size: 0.9rem;
		padding: 0.4rem 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.add {
		margin-top: 0.6rem;
	}

	.remove {
		font-size: 0.8rem;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.save {
		font-weight: 600;
		border-color: #0b6bcb;
		color: #0b6bcb;
	}

	button:hover:not(:disabled),
	button:focus-visible {
		border-color: #0b6bcb;
		color: #0b6bcb;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.saved {
		margin: 0.75rem 0 0;
		color: #2e7d32;
		font-weight: 600;
	}

	.error {
		margin: 0.75rem 0 0;
		color: #c62828;
		font-weight: 600;
	}
</style>
