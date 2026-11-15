<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { ApiError } from '$lib/api/client';
	import { aiErrorView } from './aiErrors';
	import { deletePhoto, keepPhotoAlive, photoObjectUrl, transcribe, uploadPhoto } from './api';
	import { clearDraft, loadDraft, saveDraft } from './photoDraftStore';
	import {
		DOWNSCALE_EDGE,
		KEEPALIVE_MS,
		keepaliveTarget,
		aiReadable,
		defaultEngine,
		noVisionText,
		needsDownscale,
		offlineButtonLabel,
		offlineBlockReason,
		photoReducer,
		photoToDelete,
		scaledSize,
		type Engine,
		type PhotoEvent,
		type PhotoState
	} from './photoFlow';
	import { journalHref } from './route';
	import { currentStudyDay } from '$lib/time/zone';
	import { newEntry, recordJournalEvent, saveEntry } from './store';
	import type { Capabilities } from './types';

	let {
		workspaceId,
		language,
		capabilities
	}: { workspaceId: number; language: string; capabilities: Capabilities | null } = $props();

	// The workspace this instance works in, fixed at creation: a late save,
	// poll or read must never land in a workspace picked afterwards.
	const ws = untrack(() => workspaceId);

	let flow = $state<PhotoState>({ step: 'pick' });
	let lastEngine = $state<Engine | null>(null);
	let destroyed = false;
	let photoUrl = $state<string | null>(null);
	let showPhoto = $state(true);
	let pickError = $state('');
	let saveError = $state('');
	let saving = $state(false);
	let resumed = $state(false);
	let originalText = '';
	let finished = false;
	let keepTimer: ReturnType<typeof setInterval> | undefined;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	const aiAvailable = $derived(aiReadable(capabilities?.ai ?? null));
	const noVision = $derived(noVisionText(capabilities?.ai ?? null));
	const offlineReason = $derived(
		capabilities ? offlineBlockReason(capabilities.ocr, language) : 'Checking what this server can do…'
	);
	let engine = $state<Engine>('ai');
	$effect(() => {
		engine = defaultEngine(aiAvailable);
	});

	const photoId = $derived('photoId' in flow ? flow.photoId : null);
	// A string: it only changes with the photo, not with every keystroke.
	const keepId = $derived(keepaliveTarget(flow));

	function dispatch(event: PhotoEvent): void {
		const prev = flow;
		const next = photoReducer(prev, event);
		flow = next;
		const gone = photoToDelete(prev, next);
		if (gone) {
			finished = true;
			void deletePhoto(gone).catch(() => undefined); // the janitor covers a failure
			clearDraft();
			releaseUrl();
		}
	}

	function releaseUrl(): void {
		if (photoUrl) URL.revokeObjectURL(photoUrl);
		photoUrl = null;
	}

	async function showPhotoFor(id: string): Promise<boolean> {
		try {
			const url = await photoObjectUrl(id);
			if (destroyed) {
				URL.revokeObjectURL(url);
				return false;
			}
			releaseUrl();
			photoUrl = url;
			return true;
		} catch {
			return false;
		}
	}

	onMount(async () => {
		const draft = loadDraft(ws);
		if (!draft) return;
		if (await showPhotoFor(draft.photoId)) {
			resumed = true;
			originalText = draft.text;
			flow = {
				step: 'draft',
				photoId: draft.photoId,
				text: draft.text,
				engine: draft.engine === 'offline' ? 'offline' : 'ai',
				unreadable: false
			};
		} else {
			clearDraft(); // the photo expired: nothing to resume
		}
	});

	// Keep an open draft alive; the janitor drops photos not seen for an hour.
	$effect(() => {
		clearInterval(keepTimer);
		const id = keepId;
		if (!id) return;
		keepTimer = setInterval(() => {
			keepPhotoAlive(id).catch((err) => {
				if (err instanceof ApiError && err.status === 404) {
					// A draft keeps its text; only the photo is gone.
					dispatch({
						type: 'photoExpired',
						view: {
							text: 'This photo draft expired. Choose the photo again.',
							settingsLink: false,
							offlineInstead: false,
							poll: false
						}
					});
				}
			});
		}, KEEPALIVE_MS);
		return () => clearInterval(keepTimer);
	});

	// Debounced copy of the draft text for a reload.
	$effect(() => {
		if (flow.step !== 'draft') return;
		const d = { photoId: flow.photoId, workspaceId: ws, text: flow.text, engine: flow.engine };
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => saveDraft(d), 500);
		return () => clearTimeout(saveTimer);
	});

	beforeNavigate((nav) => {
		// A reload or closing the tab keeps the draft; only in-app moves ask.
		if (finished || !photoId || nav.type === 'leave') return;
		if (!confirm('Discard this photo draft?')) {
			nav.cancel();
			return;
		}
		finished = true;
		void deletePhoto(photoId).catch(() => undefined);
		clearDraft();
	});

	onDestroy(() => {
		destroyed = true;
		clearInterval(keepTimer);
		clearTimeout(saveTimer);
		releaseUrl();
	});

	async function downscale(file: File): Promise<Blob> {
		const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
		const { width, height } = scaledSize(bitmap.width, bitmap.height, DOWNSCALE_EDGE);
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('no canvas');
		ctx.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();
		const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));
		if (!blob) throw new Error('encode failed');
		return blob;
	}

	async function onPick(e: Event): Promise<void> {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		pickError = '';
		let body: Blob = file;
		if (needsDownscale(file)) {
			try {
				body = await downscale(file);
			} catch {
				pickError = 'Choose a JPEG, PNG or WebP photo.';
				return;
			}
		}
		dispatch({ type: 'picked' });
		try {
			const { photoId: id } = await uploadPhoto(ws, body);
			dispatch({ type: 'uploaded', photoId: id });
			await showPhotoFor(id);
		} catch (err) {
			dispatch({ type: 'failed', view: aiErrorView(err, 'transcribe') });
		}
	}

	async function read(which: Engine): Promise<void> {
		const id = photoId;
		if (!id) return;
		engine = which;
		lastEngine = which;
		dispatch({ type: 'read', engine: which });
		try {
			const res = await transcribe(ws, id, which);
			originalText = res.text;
			dispatch({ type: 'readDone', text: res.text, unreadable: res.unreadable });
		} catch (err) {
			dispatch({ type: 'failed', view: aiErrorView(err, 'transcribe') });
		}
	}

	async function save(): Promise<void> {
		if (flow.step !== 'draft' || saving) return;
		saving = true;
		saveError = '';
		const id = flow.photoId;
		try {
			const entry = newEntry('photo', currentStudyDay());
			entry.text = flow.text;
			const saved = await saveEntry(ws, entry);
			const now = new Date();
			await recordJournalEvent(ws, saved.id, now).catch(() => undefined);
			dispatch({ type: 'saved' });
			if (destroyed) return;
			await goto(journalHref({ view: 'entry', id: saved.id }), { replaceState: true });
		} catch {
			saveError = 'Could not save the entry. Your draft is still here; try again.';
			saving = false;
			void id;
		}
	}

	function discard(): void {
		if (flow.step === 'draft' && flow.text !== originalText) {
			if (!confirm('Discard your changes and the photo?')) return;
		}
		dispatch({ type: 'discarded' });
		void goto(journalHref({ view: 'list' }));
	}
</script>

<h1>Photo to entry</h1>

{#if flow.step === 'pick' || (flow.step === 'error' && flow.photoId === null)}
	{#if flow.step === 'error'}
		<p class="error" role="alert">{flow.view.text}</p>
	{/if}
	<p class="hint">
		Pick a photo of a handwritten or printed page. Nothing is sent to the AI until you press a
		read button, and the photo is deleted when you save or discard.
	</p>
	<label class="pick">
		<span class="button primary">Choose a photo</span>
		<input
			type="file"
			accept="image/jpeg,image/png,image/webp"
			capture="environment"
			onchange={onPick}
		/>
	</label>
	{#if pickError}<p class="error" role="alert">{pickError}</p>{/if}
	<p><a href={journalHref({ view: 'list' })}>Back to the journal</a></p>
{:else if flow.step === 'uploading'}
	<p role="status">Uploading…</p>
{:else if flow.step === 'choose' || flow.step === 'reading' || flow.step === 'error'}
	{#if photoUrl}
		<img class="preview" src={photoUrl} alt="Your chosen page" />
	{/if}
	{#if flow.step === 'reading'}
		<p role="status">Reading the page…</p>
	{:else}
		{#if flow.step === 'error'}
			<p class="error" role="alert">{flow.view.text}</p>
			{#if flow.view.settingsLink}<p><a href="/settings?tab=ai">Open Settings → AI</a></p>{/if}
		{/if}
		<fieldset>
			<legend>Read it with</legend>
			{#if noVision}
				<p id="ai-novision" class="hint">{noVision}</p>
			{:else}
				<button
					type="button"
					class="primary"
					disabled={!aiAvailable}
					onclick={() => read('ai')}
					aria-describedby="ai-note"
				>
					Read with AI
				</button>
			{/if}
			<button
				type="button"
				class="secondary"
				disabled={offlineReason !== null}
				onclick={() => read('offline')}
				aria-describedby="offline-note"
			>
				{offlineButtonLabel({
					failedEngine: lastEngine,
					offlineInstead: flow.step === 'error' && flow.view.offlineInstead
				})}
			</button>
			<p id="ai-note" class="hint">
				{#if capabilities === null}Checking what this server can do…
				{:else if noVision}Pick a model that reads photos in Settings → AI, or read it offline.
				{:else if aiAvailable}Sends this photo to your AI provider with your own key.
				{:else}AI is not available. Set it up in Settings → AI.{/if}
			</p>
			<p id="offline-note" class="hint">
				{offlineReason ?? 'Runs on the server; the photo goes nowhere else.'}
			</p>
		</fieldset>
		<button type="button" class="secondary danger" onclick={discard}>Discard photo</button>
	{/if}
{:else if flow.step === 'draft'}
	<p class="notice" role="note">Draft: check it against the photo before saving.</p>
	{#if flow.expired}
		<p class="error" role="alert">
			The photo expired on the server. Your text is kept: save it as an entry.
		</p>
	{/if}
	{#if resumed}<p class="hint">Resumed your photo draft.</p>{/if}
	{#if flow.unreadable}<p class="hint" role="status">No text found on this photo.</p>{/if}
	<div class="side">
		<div class="photo">
			<button type="button" class="secondary toggle" onclick={() => (showPhoto = !showPhoto)}>
				{showPhoto ? 'Hide photo' : 'Show photo'}
			</button>
			{#if showPhoto && photoUrl}
				<img class="preview" src={photoUrl} alt="Your page, for checking the transcription" />
			{/if}
		</div>
		<label class="text">
			<span>Transcription</span>
			<textarea
				rows="14"
				value={flow.text}
				oninput={(e) => dispatch({ type: 'edit', text: e.currentTarget.value })}
			></textarea>
		</label>
	</div>
	{#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
	<div class="row">
		<button type="button" class="primary" disabled={saving} onclick={save}>Save as entry</button>
		<button type="button" class="secondary danger" onclick={discard}>Discard</button>
	</div>
{/if}

<style>
	.pick {
		display: inline-block;
	}

	.pick .button {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 1rem;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}

	/* The native input stays reachable for keyboards and screen readers. */
	.pick input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		overflow: hidden;
	}

	.pick:focus-within .button {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}

	.preview {
		max-width: 100%;
		max-height: 70vh;
		object-fit: contain;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.4rem;
	}

	.notice {
		border-left: 4px solid #b26a00;
		padding: 0.5rem 0.75rem;
		font-weight: 600;
	}

	.side {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr 1fr;
		align-items: start;
	}

	.text textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
	}

	.text span {
		display: block;
		font-weight: 600;
	}

	.toggle {
		display: none;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	@media (max-width: 45rem) {
		.side {
			grid-template-columns: 1fr;
		}

		.toggle {
			display: inline-block;
		}
	}
</style>
