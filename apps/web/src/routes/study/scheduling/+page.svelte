<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import ImportExport from '$lib/plugins/flashcards/scheduling/ImportExport.svelte';
	import OptimizePanel from '$lib/plugins/flashcards/scheduling/OptimizePanel.svelte';
	import PreviewPanel from '$lib/plugins/flashcards/scheduling/PreviewPanel.svelte';
	import SavedSets from '$lib/plugins/flashcards/scheduling/SavedSets.svelte';
	import { buildDataset, type Dataset } from '$lib/study/fsrs/dataset';
	import { evaluate, type Fit } from '$lib/study/fsrs/evaluate';
	import type { OptimizeResult } from '$lib/study/fsrs/optimize';
	import { runOptimizer } from '$lib/study/fsrs/optimizerClient';
	import { DEFAULT_W, type FsrsState } from '$lib/study/fsrs/params';
	import { canApply, previewChange } from '$lib/study/fsrs/preview';
	import {
		deleteParamSet,
		loadStudyData,
		saveParamSet,
		setActiveSet
	} from '$lib/study/store';
	import type { ReviewEvent, StudyCard } from '$lib/study/types';
	import { workspaces } from '$lib/workspaces';

	interface Candidate {
		workspaceId: number;
		w: number[];
		source: 'optimized' | 'imported';
		labelled?: number;
		logLoss?: number;
		baselineLogLoss: number;
	}

	const UNDO_MS = 10000;
	const EMPTY_FIT: Fit = { logLoss: 0, rmseBins: 0 };

	const workspaceId = $derived($workspaces.current?.id ?? null);

	let loading = $state(true);
	let loadError = $state('');
	let cards = $state.raw<StudyCard[]>([]);
	let reviews = $state.raw<ReviewEvent[]>([]);
	let dataset = $state.raw<Dataset>({ cards: [], labelled: 0 });
	let fsrs = $state.raw<FsrsState>({ sets: [], active: null, w: DEFAULT_W });
	let activeFit = $state.raw<Fit>(EMPTY_FIT);

	let running = $state(false);
	let progress = $state(0);
	let result = $state.raw<OptimizeResult | null>(null);
	let optimiseError = $state('');
	let candidate = $state.raw<Candidate | null>(null);
	let busy = $state(false);
	let actionError = $state('');
	let controller: AbortController | null = null;
	let seq = 0;

	let undo = $state<{ text: string; previousId: string | null; workspaceId: number } | null>(null);
	let undoTimer: ReturnType<typeof setTimeout> | undefined;

	onDestroy(() => {
		controller?.abort();
		clearTimeout(undoTimer);
	});

	async function load(id: number | null): Promise<void> {
		const mine = ++seq;
		controller?.abort();
		running = false;
		result = null;
		candidate = null;
		optimiseError = '';
		actionError = '';
		undo = null;
		if (id === null) {
			loading = false;
			return;
		}
		loading = true;
		loadError = '';
		try {
			const data = await loadStudyData(id);
			if (mine !== seq) return;
			cards = data.cards;
			reviews = data.reviews;
			dataset = buildDataset(data.reviews);
			fsrs = data.fsrs ?? { sets: [], active: null, w: DEFAULT_W };
			activeFit = evaluate(fsrs.w, dataset);
		} catch (err) {
			if (mine !== seq) return;
			loadError = err instanceof Error ? err.message : 'Could not load your flashcards.';
		} finally {
			if (mine === seq) loading = false;
		}
	}

	$effect(() => {
		const id = workspaceId;
		void untrack(() => load(id));
	});

	async function optimise(): Promise<void> {
		if (workspaceId === null || running) return;
		const started = workspaceId;
		const mine = seq;
		controller = new AbortController();
		running = true;
		progress = 0;
		result = null;
		candidate = null;
		optimiseError = '';
		const baseline = activeFit.logLoss;
		try {
			const r = await runOptimizer(dataset, {
				signal: controller.signal,
				onProgress: (f) => (progress = f)
			});
			if (mine !== seq) return;
			result = r;
			if (r.ok) {
				candidate = {
					workspaceId: started,
					w: r.w,
					source: 'optimized',
					labelled: r.labelled,
					logLoss: r.logLoss,
					baselineLogLoss: baseline
				};
			}
		} catch (err) {
			if (mine !== seq) return;
			optimiseError = err instanceof Error ? err.message : 'The optimizer failed.';
		} finally {
			if (mine === seq) running = false;
		}
	}

	function cancel(): void {
		controller?.abort();
	}

	function importWeights(w: number[]): void {
		if (workspaceId === null) return;
		result = null;
		candidate = {
			workspaceId,
			w,
			source: 'imported',
			baselineLogLoss: activeFit.logLoss
		};
	}

	const preview = $derived(
		candidate === null
			? null
			: previewChange({ cards, reviews, from: fsrs.w, to: candidate.w, now: new Date() })
	);
	const check = $derived(
		candidate === null
			? ({ ok: false, reason: '' } as const)
			: canApply({
					candidate: candidate.logLoss === undefined ? null : { logLoss: candidate.logLoss },
					activeLogLoss: candidate.baselineLogLoss,
					startedWorkspace: candidate.workspaceId,
					currentWorkspace: workspaceId,
					source: candidate.source
				})
	);

	function offerUndo(text: string, previousId: string | null, id: number): void {
		undo = { text, previousId, workspaceId: id };
		clearTimeout(undoTimer);
		undoTimer = setTimeout(() => (undo = null), UNDO_MS);
	}

	/** change runs one write, reloads, and offers Undo for a pointer change. */
	async function change(
		write: (id: number) => Promise<void>,
		text: string | null
	): Promise<void> {
		if (workspaceId === null || busy) return;
		const id = workspaceId;
		const previousId = fsrs.active?.id ?? null;
		busy = true;
		actionError = '';
		try {
			await write(id);
			if (id !== workspaceId) return;
			await reloadData(id);
			if (text !== null) offerUndo(text, previousId, id);
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Could not save.';
		} finally {
			busy = false;
		}
	}

	async function reloadData(id: number): Promise<void> {
		const data = await loadStudyData(id);
		if (id !== workspaceId) return;
		fsrs = data.fsrs ?? { sets: [], active: null, w: DEFAULT_W };
		activeFit = evaluate(fsrs.w, dataset);
	}

	async function apply(): Promise<void> {
		const c = candidate;
		if (c === null || !check.ok) return;
		await change(async (id) => {
			if (id !== c.workspaceId) throw new Error('The workspace changed. Optimise again.');
			const saved = await saveParamSet(id, {
				w: c.w,
				source: c.source,
				labelled: c.labelled,
				logLoss: c.logLoss,
				baselineLogLoss: c.source === 'optimized' ? c.baselineLogLoss : undefined
			});
			await setActiveSet(id, saved.id);
			candidate = null;
			result = null;
		}, 'Parameters changed.');
	}

	function discard(): void {
		candidate = null;
		result = null;
	}

	function use(setId: string | null): Promise<void> {
		return change((id) => setActiveSet(id, setId), 'Parameters changed.');
	}

	function remove(setId: string): Promise<void> {
		return change((id) => deleteParamSet(id, setId), null);
	}

	async function undoLast(): Promise<void> {
		const slot = undo;
		if (slot === null || busy || slot.workspaceId !== workspaceId) return;
		clearTimeout(undoTimer);
		busy = true;
		try {
			await setActiveSet(slot.workspaceId, slot.previousId);
			undo = null;
			await reloadData(slot.workspaceId);
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Could not undo.';
		} finally {
			busy = false;
		}
	}

	const activeLabel = $derived(
		fsrs.active === null
			? 'Default parameters'
			: `${fsrs.active.source === 'optimized' ? 'Optimised' : 'Imported'} ${fsrs.active.createdAt.slice(0, 10)}${
					fsrs.active.labelled === undefined ? '' : ` · ${fsrs.active.labelled.toLocaleString()} reviews`
				}`
	);
</script>

<main class="page">
	<p><a href="/study">Back to study setup</a></p>
	<h1>Scheduling</h1>

	{#if workspaceId === null}
		<p>Select a workspace to tune its scheduling.</p>
	{:else if loading}
		<p role="status">Loading your reviews…</p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
		<button type="button" onclick={() => load(workspaceId)}>Try again</button>
	{:else}
		<p>
			Active: {activeLabel}
			{#if fsrs.active !== null}
				<button type="button" disabled={busy} onclick={() => use(null)}>Use defaults</button>
			{/if}
		</p>

		<OptimizePanel
			labelled={dataset.labelled}
			{running}
			{progress}
			{result}
			{activeFit}
			error={optimiseError}
			onOptimise={optimise}
			onCancel={cancel}
		/>

		{#if candidate !== null && preview !== null}
			<PreviewPanel {preview} {check} {busy} onApply={apply} onDiscard={discard} />
		{/if}

		<SavedSets
			sets={fsrs.sets}
			activeId={fsrs.active?.id ?? null}
			{busy}
			onUse={(id) => use(id)}
			onDelete={(id) => remove(id)}
			onDefaults={() => use(null)}
		/>

		<ImportExport activeW={fsrs.w} {busy} onImport={importWeights} />

		{#if actionError}
			<p class="error" role="alert">{actionError}</p>
		{/if}
	{/if}
</main>

<div class="toast-region" role="status" aria-live="polite">
	{#if undo}
		<div
			class="toast"
			role="presentation"
			onmouseenter={() => clearTimeout(undoTimer)}
			onfocusin={() => clearTimeout(undoTimer)}
		>
			<span>{undo.text}</span>
			<button type="button" disabled={busy} onclick={undoLast}>Undo</button>
		</div>
	{/if}
</div>

<style>
	.page {
		margin: 0 auto;
		max-width: 48rem;
		padding: 2.5rem 1.5rem;
	}

	.page :global(section) {
		margin-top: 2rem;
	}

	button {
		min-height: 44px;
		min-width: 44px;
		padding: 0 1rem;
	}

	.error {
		color: #b3261e;
	}

	.toast-region {
		position: fixed;
		inset: auto 0 calc(1rem + var(--bottom-bar-height, 0px)) 0;
		display: flex;
		justify-content: center;
		pointer-events: none;
		z-index: 50;
	}

	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 1rem;
		background: #222;
		color: #fff;
		border-radius: 0.5rem;
		padding: 0.6rem 1rem;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.3);
	}
</style>
