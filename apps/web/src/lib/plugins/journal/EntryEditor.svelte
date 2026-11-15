<script module lang="ts">
	// One `journal` study event per entry per UTC day per tab.
	const sentEvents = new Map<string, string>();
</script>

<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { postEvents } from '$lib/events';
	import AnnotationList from './AnnotationList.svelte';
	import IdeasPanel from './IdeasPanel.svelte';
	import OverallReview from './OverallReview.svelte';
	import ReviewText from './ReviewText.svelte';
	import { aiErrorView, type AiErrorView } from './aiErrors';
	import { anchorAnnotations, isOutdated, originalCounts } from './anchor';
	import { requestReview } from './api';
	import {
		AUTOSAVE_MS,
		MAX_REVIEW_CHARS,
		codePoints,
		journalEvent,
		journalEventDue
	} from './entryDraft';
	import {
		ENTRY_MAX_CHARS,
		aiButtonGate,
		canGotoAfterFirstSave,
		editorTarget,
		isEntryGone,
		navigationPlan,
		tooLongHint,
		listedAnnotations,
		reviewAnnouncement,
		saveStatusText,
		type SaveState
	} from './editorLogic';
	import { pollForReview } from './reviewPoll';
	import { journalHref, newEntryHref } from './route';
	import { deleteEntry, getEntry, getReview, newEntry, saveEntry } from './store';
	import type { JournalEntry, Review } from './types';

	let {
		workspaceId,
		entryId,
		initialTitle,
		aiAvailable,
		aiBanner
	}: {
		workspaceId: number;
		entryId: string | null;
		initialTitle: string;
		aiAvailable: boolean | null;
		aiBanner: string | null;
	} = $props();

	// The workspace this editor works in, fixed at creation. A save, review
	// or delete that finishes late must never reach a workspace chosen later.
	const ws = untrack(() => workspaceId);
	const aborter = new AbortController();
	let destroyed = false;
	let internalNav = false; // our own address change after the first save
	let gone = false; // the entry was deleted: stop saving it

	let entry = $state<JournalEntry | null>(null);
	let originals = $state<Record<string, number>>({});
	let loadState = $state<'loading' | 'ready' | 'notfound' | 'error'>('loading');
	let title = $state('');
	let text = $state('');
	let date = $state('');
	let persisted = $state(false); // the entry exists on the server
	let savedText = '';
	let dirty = false;
	let saveState = $state<SaveState>('idle');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let saveChain: Promise<boolean> = Promise.resolve(true);

	let mode = $state<'edit' | 'review'>('edit');
	let review = $state<Review | null>(null);
	let reviewing = $state(false);
	let reviewStatus = $state('');
	let failure = $state<AiErrorView | null>(null);
	let showIdeas = $state(false);
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state('');

	let textarea = $state<HTMLTextAreaElement>();
	let heading = $state<HTMLHeadingElement>();
	let reviewHeading = $state<HTMLHeadingElement>();
	let deleteButton = $state<HTMLButtonElement>();
	let cancelDelete = $state<HTMLButtonElement>();
	let reviewText = $state<{ focusAnnotation(id: string): Promise<void> }>();

	const chars = $derived(codePoints(text));
	const reviewGate = $derived(
		aiButtonGate({ available: aiAvailable, banner: aiBanner, chars, forReview: true })
	);
	const ideasGate = $derived(
		aiButtonGate({ available: aiAvailable, banner: aiBanner, chars, forReview: false })
	);
	const anchoring = $derived(review ? anchorAnnotations(text, review.annotations, originals) : null);
	const outdated = $derived(review ? isOutdated(text, review) : false);
	const listed = $derived(
		review && anchoring ? listedAnnotations(review.annotations, anchoring) : []
	);

	function touch(): void {
		dirty = true;
		saveState = 'dirty';
		clearTimeout(timer);
		timer = setTimeout(() => void flush(), AUTOSAVE_MS);
	}

	/** Saves now if there is anything unsaved; resolves false when the save failed. */
	function flush(opts: { keepalive?: boolean } = {}): Promise<boolean> {
		clearTimeout(timer);
		saveChain = saveChain.then(() => doSave(opts));
		return saveChain;
	}

	async function doSave(opts: { keepalive?: boolean } = {}): Promise<boolean> {
		if (!entry || !dirty || gone) return true;
		// Nothing typed yet: an untouched new entry is never created.
		if (!persisted && title.trim() === '' && text.trim() === '') {
			dirty = false;
			saveState = 'idle';
			return true;
		}
		dirty = false;
		saveState = 'saving';
		const snapshot: JournalEntry = { ...entry, title, text, date: date || entry.date };
		const textChanged = snapshot.text !== savedText;
		try {
			const saved = await saveEntry(ws, snapshot, opts);
			entry = saved;
			savedText = saved.text;
			const firstSave = !persisted;
			persisted = true;
			if (textChanged) void recordEvent(saved.id);
			saveState = dirty ? 'dirty' : 'saved';
			if (firstSave && canGotoAfterFirstSave({ destroyed, routeEntryId: entryId })) {
				// The address now names the entry, so a reload comes back to it.
				internalNav = true;
				try {
					await goto(journalHref({ view: 'entry', id: saved.id }), {
						replaceState: true,
						keepFocus: true,
						noScroll: true
					});
				} finally {
					internalNav = false;
				}
			}
			return true;
		} catch {
			dirty = true;
			saveState = 'error';
			return false;
		}
	}

	async function recordEvent(id: string): Promise<void> {
		const now = new Date();
		if (!journalEventDue(id, true, now, sentEvents)) return;
		try {
			await postEvents([journalEvent(ws, id, now)]);
		} catch {
			// Telemetry only; allow another try on the next save.
			sentEvents.delete(id);
		}
	}

	async function load(id: string | null): Promise<void> {
		clearTimeout(timer);
		await flush();
		mode = 'edit';
		review = null;
		reviewStatus = '';
		failure = null;
		showIdeas = false;
		confirmingDelete = false;
		deleteError = '';
		saveState = 'idle';
		dirty = false;
		gone = false;
		originals = {};
		if (id === null) {
			const fresh = newEntry('typed');
			entry = fresh;
			title = initialTitle;
			text = '';
			date = fresh.date;
			persisted = false;
			savedText = '';
			loadState = 'ready';
			await tick();
			(initialTitle ? textarea : heading)?.focus();
			return;
		}
		loadState = 'loading';
		try {
			const found = await getEntry(ws, id);
			if (!found) {
				entry = null;
				loadState = 'notfound';
				return;
			}
			entry = found;
			title = found.title;
			text = found.text;
			date = found.date;
			persisted = true;
			savedText = found.text;
			loadState = 'ready';
			getReview(ws, id).then(
				(r) => {
					if (entry?.id !== id) return;
					review = r;
					// The reviewed text is only known while the text is unchanged.
					originals = r && !isOutdated(text, r) ? originalCounts(text, r.annotations) : {};
				},
				() => {}
			);
		} catch {
			entry = null;
			loadState = 'error';
		}
	}

	// Follows the address: a different entry, or a new one. The first save
	// of a new entry changes the address to its own id, which is a no-op.
	$effect(() => {
		const id = entryId;
		// Read so that a new title (Ideas → Start an entry) re-runs the effect.
		void editorTarget(entryId, initialTitle);
		untrack(() => {
			if (id !== null && id === entry?.id) return;
			void load(id);
		});
	});

	function setReview(r: Review): void {
		review = r;
		mode = 'review';
		originals = isOutdated(text, r) ? {} : originalCounts(text, r.annotations);
		const a = anchorAnnotations(text, r.annotations, originals);
		reviewStatus = reviewAnnouncement(a.placed.length + a.listOnly.length, a.missing.length);
		void tick().then(() => reviewHeading?.focus());
	}

	async function runReview(): Promise<void> {
		if (!entry || reviewing || !reviewGate.enabled) return;
		const id = entry.id;
		failure = null;
		reviewStatus = '';
		if (!(await flush())) {
			failure = {
				text: 'The entry could not be saved, so it was not sent. Try again.',
				settingsLink: false,
				offlineInstead: false,
				poll: false
			};
			return;
		}
		reviewing = true;
		reviewStatus = 'Reviewing… (this can take a minute)';
		const since = review?.createdAt ?? '';
		try {
			const r = await requestReview(ws, id, aborter.signal);
			if (entry?.id === id) setReview(r);
		} catch (err) {
			if (destroyed) return;
			const view = aiErrorView(err, 'review');
			if (isEntryGone(err) && view.text === 'This entry was deleted.') markGone();
			if (view.poll) {
				reviewStatus = 'Still waiting for the review… (checking every few seconds)';
				const late = await pollForReview(() => getReview(ws, id), since, {
					signal: aborter.signal
				});
				if (destroyed) return;
				if (late) {
					if (entry?.id === id) setReview(late);
					return;
				}
			}
			reviewStatus = '';
			if (entry?.id === id) failure = view;
		} finally {
			reviewing = false;
		}
	}

	/** The entry no longer exists on the server: keep the text on screen, but stop saving. */
	function markGone(): void {
		gone = true;
		dirty = false;
		clearTimeout(timer);
		saveState = 'idle';
	}

	async function backToEdit(): Promise<void> {
		mode = 'edit';
		await tick();
		textarea?.focus();
	}

	function showReview(): void {
		mode = 'review';
		void tick().then(() => reviewHeading?.focus());
	}

	async function startFromIdea(ideaTitle: string): Promise<void> {
		await flush();
		await goto(newEntryHref(ideaTitle));
	}

	async function askDelete(): Promise<void> {
		confirmingDelete = true;
		await tick();
		cancelDelete?.focus();
	}

	async function abortDelete(): Promise<void> {
		confirmingDelete = false;
		await tick();
		deleteButton?.focus();
	}

	async function confirmDelete(): Promise<void> {
		if (!entry || deleting) return;
		clearTimeout(timer);
		dirty = false;
		deleting = true;
		deleteError = '';
		gone = true;
		try {
			// A save that is already on its way must land before the delete, not after.
			await saveChain.catch(() => false);
			if (persisted) await deleteEntry(ws, entry.id);
			await goto(journalHref({ view: 'list' }));
		} catch {
			gone = false;
			deleteError = 'Could not delete the entry. Try again.';
			deleting = false;
		}
	}

	let leaving = false;
	beforeNavigate((nav) => {
		// Closing the tab or reloading cannot wait; pagehide sends a keepalive save.
		if (nav.type === 'leave' || leaving || internalNav || deleting || navigationPlan(saveState) === 'proceed') {
			void flush();
			return;
		}
		// Moving inside the app: finish the save first, and ask if it fails.
		const target = nav.to?.url;
		nav.cancel();
		leaving = true;
		void flush().then(async (ok) => {
			if (ok || confirm('This entry could not be saved. Leave anyway and lose the unsaved changes?')) {
				if (target) await goto(target);
			}
			leaving = false;
		});
	});

	onDestroy(() => {
		destroyed = true;
		aborter.abort();
		void flush();
	});

	function onVisibility(): void {
		if (document.visibilityState === 'hidden') void flush({ keepalive: true });
	}

	function pickAnnotation(id: string): void {
		void reviewText?.focusAnnotation(id);
	}
</script>

<svelte:document onvisibilitychange={onVisibility} />
<svelte:window onpagehide={() => void flush({ keepalive: true })} />

<p><a href={journalHref({ view: 'list' })}>← Journal</a></p>

{#if loadState === 'loading'}
	<p role="status">Loading…</p>
{:else if loadState === 'notfound'}
	<h1>Entry not found</h1>
	<p>It may have been deleted, or it belongs to another workspace.</p>
	<p><a href={journalHref({ view: 'list' })}>Back to your entries</a></p>
{:else if loadState === 'error' || !entry}
	<p class="error" role="alert">Could not load the entry.</p>
	<button type="button" class="secondary" onclick={() => load(entryId)}>Retry</button>
{:else}
	<h1 bind:this={heading} tabindex="-1">{persisted ? 'Entry' : 'New entry'}</h1>

	{#if mode === 'edit'}
		<form class="editor" onsubmit={(e) => e.preventDefault()}>
			<div class="row">
				<label class="date">
					<span>Date</span>
					<input type="date" bind:value={date} required oninput={touch} onblur={() => void flush()} />
				</label>
				<label class="grow">
					<span>Title (optional)</span>
					<input
						type="text"
						bind:value={title}
						maxlength="200"
						oninput={touch}
						onblur={() => void flush()}
					/>
				</label>
			</div>
			<label>
				<span>Entry</span>
				<textarea
					bind:this={textarea}
					bind:value={text}
					rows="14"
					maxlength={ENTRY_MAX_CHARS}
					aria-describedby="entry-count"
					oninput={touch}
					onblur={() => void flush()}
				></textarea>
			</label>
			<p id="entry-count" class="count" class:over={chars > MAX_REVIEW_CHARS}>
				{chars.toLocaleString('en')} / {MAX_REVIEW_CHARS.toLocaleString('en')} for review
			</p>
			{#if chars > MAX_REVIEW_CHARS}
				<p class="count over">{tooLongHint(chars)}</p>
			{/if}
			{#if text.length >= ENTRY_MAX_CHARS}
				<p class="count over">This is the longest an entry can be. Split it into two entries.</p>
			{/if}
		</form>
		<div class="save-status" aria-live="polite">{saveStatusText(saveState)}</div>
		{#if saveState === 'error'}
			<button type="button" class="secondary" onclick={() => void flush()}>Save</button>
		{/if}
	{:else if review && anchoring}
		<h2 bind:this={reviewHeading} tabindex="-1">Review</h2>
		<p class="meta">{date}{title.trim() ? ' · ' + title.trim() : ''}</p>
		{#if outdated}
			<div class="outdated">
				<p>Written for an earlier version</p>
				<button
					type="button"
					onclick={runReview}
					disabled={reviewing || !reviewGate.enabled}
					aria-describedby={reviewGate.hint ? 'review-hint' : undefined}
				>
					Review again
				</button>
			</div>
		{/if}
		<OverallReview {review} />
		<ReviewText
			bind:this={reviewText}
			{text}
			placed={anchoring.placed}
			annotations={review.annotations}
		/>
		<AnnotationList {listed} missing={anchoring.missing} onpick={pickAnnotation} />
		<div class="actions">
			<button type="button" class="secondary" onclick={backToEdit}>Edit</button>
		</div>
	{/if}

	<div class="actions" role="group" aria-label="Entry actions">
		{#if mode === 'edit'}
			<button
				type="button"
				onclick={runReview}
				disabled={reviewing || !reviewGate.enabled}
				aria-describedby={reviewGate.hint ? 'review-hint' : undefined}
			>
				{reviewing ? 'Reviewing…' : 'Review'}
			</button>
			<button
				type="button"
				class="secondary"
				onclick={() => (showIdeas = !showIdeas)}
				disabled={!ideasGate.enabled && !showIdeas}
				aria-expanded={showIdeas}
				aria-describedby={ideasGate.hint ? 'ideas-hint' : undefined}
			>
				Ideas
			</button>
			{#if review}
				<button type="button" class="secondary" onclick={showReview}>Show last review</button>
			{/if}
		{/if}
		{#if confirmingDelete}
			<span class="confirm" role="group" aria-label="Delete this entry?">
				Delete this entry and its review?
				<button
					type="button"
					class="secondary danger"
					onclick={confirmDelete}
					disabled={deleting}
				>
					Yes, delete
				</button>
				<button type="button" class="secondary" bind:this={cancelDelete} onclick={abortDelete}>
					Cancel
				</button>
			</span>
		{:else}
			<button type="button" class="secondary danger" bind:this={deleteButton} onclick={askDelete}>
				Delete
			</button>
		{/if}
	</div>

	{#if reviewGate.hint && mode === 'edit' && !reviewGate.enabled}
		<p id="review-hint" class="hint">
			{reviewGate.hint}{#if reviewGate.settingsLink}
				{' '}<a href="/settings?tab=ai">Open Settings → AI</a>{/if}
		</p>
	{/if}
	{#if ideasGate.hint && mode === 'edit' && !ideasGate.enabled}
		<p id="ideas-hint" class="hint">{ideasGate.hint}</p>
	{/if}

	<div class="live" aria-live="polite">{reviewStatus}</div>
	{#if failure}
		<p class="error" role="alert">
			{failure.text}
			{#if failure.settingsLink}<a href="/settings?tab=ai">Open Settings → AI</a>{/if}
		</p>
	{/if}
	{#if deleteError}<p class="error" role="alert">{deleteError}</p>{/if}

	{#if showIdeas && mode === 'edit'}
		<IdeasPanel workspaceId={ws} gate={ideasGate} onstart={startFromIdea} />
	{/if}
{/if}

<style>
	h1:focus,
	h2:focus {
		outline: none;
	}

	.editor {
		display: grid;
		gap: 0.75rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.grow {
		flex: 1 1 12rem;
	}

	label {
		display: grid;
		gap: 0.3rem;
		font-weight: 600;
	}

	input,
	textarea {
		font: inherit;
		font-weight: 400;
		padding: 0.5rem 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
	}

	textarea {
		line-height: 1.6;
		resize: vertical;
	}

	.count {
		margin: 0;
		opacity: 0.8;
		font-size: 0.9rem;
	}

	.count.over {
		color: #c62828;
		opacity: 1;
		font-weight: 600;
	}

	.save-status,
	.live {
		min-height: 1.4em;
		font-size: 0.9rem;
	}

	.actions,
	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		margin: 0.75rem 0;
	}

	.outdated {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		border-left: 4px solid #b26a00;
		padding: 0.25rem 0.75rem;
		margin: 0.5rem 0;
	}

	.outdated p {
		margin: 0;
		font-weight: 600;
	}

	.meta {
		opacity: 0.8;
		overflow-wrap: anywhere;
	}

	@media (prefers-color-scheme: dark) {
		.count.over {
			color: #ff8a80;
		}

		.outdated {
			border-left-color: #ffb74d;
		}
	}
</style>
