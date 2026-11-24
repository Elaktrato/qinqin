<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { UserError } from '$lib/api/userError';
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
	import { onDestroy, untrack } from 'svelte';
	import ImportExport from '$lib/features/flashcards/scheduling/ImportExport.svelte';
	import OptimizePanel from '$lib/features/flashcards/scheduling/OptimizePanel.svelte';
	import PreviewPanel from '$lib/features/flashcards/scheduling/PreviewPanel.svelte';
	import SavedSets from '$lib/features/flashcards/scheduling/SavedSets.svelte';
import { contextForData, currentContext } from '$lib/study/currentContext';
import type { StudyContext } from '$lib/study/studyContext';
	import { buildDataset, type Dataset } from '$lib/study/fsrs/dataset';
	import { evaluate, type Fit } from '$lib/study/fsrs/evaluate';
	import type { HeldOut, OptimizeResult } from '$lib/study/fsrs/optimize';
	import { runOptimizer, runPreview } from '$lib/study/fsrs/optimizerClient';
	import { activeProblem, sameWeights, shouldRestorePointer } from '$lib/study/fsrs/guard';
	import { DEFAULT_W, type FsrsState } from '$lib/study/fsrs/params';
	import { canApply, type Preview } from '$lib/study/fsrs/preview';
	import { deleteParamSet, saveParamSet, setActiveSet } from '$lib/study/commands/settings';
	import { loadStudyData } from '$lib/study/data';
	import type { ReviewEvent, StudyCard } from '$lib/study/types';
	import { Button } from '$lib/ui';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	interface Candidate {
		workspaceId: number;
		w: number[];
		source: 'optimized' | 'imported';
		labelled?: number;
		logLoss?: number;
		heldOut?: HeldOut | null;
		/** The weights the gate and the preview compare with. */
		fromW: readonly number[];
		baselineLogLoss: number;
		/** Fit of the candidate on the whole log, for imports and the preview. */
		fit: Fit;
	}

	const UNDO_MS = 10000;
	const EMPTY_FIT: Fit = { logLoss: 0, rmseBins: 0, items: 0 };

	const workspaceId = $derived(session.workspaces.current?.id ?? null);

	let loading = $state(true);
	let loadError = $state('');
	let cards = $state.raw<StudyCard[]>([]);
	let reviews = $state.raw<ReviewEvent[]>([]);
	let ctx = $state.raw<StudyContext>(currentContext());
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

	let undo = $state<{
		text: string;
		previousId: string | null;
		wrote: string | null;
		workspaceId: number;
	} | null>(null);
	let undoTimer: ReturnType<typeof setTimeout> | undefined;
	let undoLeft = UNDO_MS;
	let undoStarted = 0;

	// While a run is going nothing else may change the weights it compares with.
	const locked = $derived(busy || running);
	const problem = $derived(activeProblem(fsrs));

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
			const data = await loadStudyData(session.study, id);
			if (mine !== seq) return;
			cards = data.cards;
			reviews = data.reviews;
			ctx = contextForData(data, id);
			dataset = buildDataset(data.reviews, ctx.clock);
			fsrs = data.fsrs ?? { sets: [], active: null, w: DEFAULT_W };
			activeFit = evaluate(fsrs.w, dataset);
		} catch (err) {
			if (mine !== seq) return;
			loadError = errorText(err, t('study.sched.loadFailed'));
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
		const startW = [...fsrs.w];
		try {
			const r = await runOptimizer(dataset, {
				current: startW,
				signal: controller.signal,
				onProgress: (f) => (progress = f)
			});
			if (mine !== seq) return;
			if (!sameWeights(startW, fsrs.w)) {
				optimiseError = t('study.sched.changedWhileOptimising');
				return;
			}
			result = r;
			if (r.ok) {
				const fromW = [...fsrs.w];
				candidate = {
					workspaceId: started,
					w: r.w,
					source: 'optimized',
					labelled: r.labelled,
					logLoss: r.logLoss,
					heldOut: r.heldOut,
					fromW,
					baselineLogLoss: evaluate(fromW, dataset).logLoss,
					fit: { logLoss: r.logLoss, rmseBins: r.rmseBins, items: r.labelled }
				};
			}
		} catch (err) {
			if (mine !== seq) return;
			optimiseError = errorText(err, t('study.sched.optimizerFailed'));
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
		const fromW = [...fsrs.w];
		candidate = {
			workspaceId,
			w,
			source: 'imported',
			fromW,
			baselineLogLoss: evaluate(fromW, dataset).logLoss,
			fit: evaluate(w, dataset)
		};
	}

	let preview = $state.raw<Preview | null>(null);
	let previewError = $state('');
	let previewPending = $state(false);

	// The preview replays every reviewed card twice; it runs in a worker.
	$effect(() => {
		const c = candidate;
		const data = { cards, reviews };
		preview = null;
		previewError = '';
		if (c === null) {
			previewPending = false;
			return;
		}
		previewPending = true;
		const ctl = new AbortController();
		runPreview(
			{ ...data, from: c.fromW, to: c.w, now: new Date(), ctx },
			{ signal: ctl.signal }
		)
			.then((p) => {
				preview = p;
				previewPending = false;
			})
			.catch((err: unknown) => {
				if (ctl.signal.aborted) return;
				previewError = errorText(err, t('study.fsrs.previewFailed'));
				previewPending = false;
			});
		return () => ctl.abort();
	});
	const check = $derived(
		candidate === null
			? ({ ok: false, reason: '' } as const)
			: canApply({
					candidate:
						candidate.logLoss === undefined
							? null
							: { logLoss: candidate.logLoss, heldOut: candidate.heldOut },
					activeLogLoss: candidate.baselineLogLoss,
					startedWorkspace: candidate.workspaceId,
					currentWorkspace: workspaceId,
					source: candidate.source
				})
	);

	function startUndoTimer(): void {
		clearTimeout(undoTimer);
		undoStarted = Date.now();
		undoTimer = setTimeout(() => (undo = null), undoLeft);
	}

	function pauseUndoTimer(): void {
		if (undo === null) return;
		clearTimeout(undoTimer);
		undoLeft = Math.max(1000, undoLeft - (Date.now() - undoStarted));
	}

	function offerUndo(text: string, previousId: string | null, wrote: string | null, id: number): void {
		undo = { text, previousId, wrote, workspaceId: id };
		undoLeft = UNDO_MS;
		startUndoTimer();
	}

	/**
	 * change runs one write that returns the pointer it wrote (or undefined
	 * for a write that does not move it), reloads, drops any open candidate
	 * and offers Undo for a pointer change. `verify` may report a problem
	 * found in the reloaded state.
	 */
	async function change(
		write: (id: number) => Promise<string | null | undefined>,
		text: string | null,
		verify?: (before: string | null) => string | null
	): Promise<void> {
		if (workspaceId === null || locked) return;
		const id = workspaceId;
		const previousId = fsrs.active?.id ?? null;
		const pointerBefore = fsrs.pointer ?? null;
		busy = true;
		actionError = '';
		try {
			const wrote = await write(id);
			if (id !== workspaceId) return;
			candidate = null;
			result = null;
			await reloadData(id);
			if (text !== null && wrote !== undefined) offerUndo(text, previousId, wrote, id);
			const problemText = verify?.(pointerBefore) ?? null;
			if (problemText !== null) actionError = problemText;
		} catch (err) {
			actionError = errorText(err, t('study.sched.saveFailed'));
		} finally {
			busy = false;
		}
	}

	async function reloadData(id: number): Promise<void> {
		const data = await loadStudyData(session.study, id);
		if (id !== workspaceId) return;
		fsrs = data.fsrs ?? { sets: [], active: null, w: DEFAULT_W };
		activeFit = evaluate(fsrs.w, dataset);
	}

	async function apply(): Promise<void> {
		const c = candidate;
		if (c === null || !check.ok) return;
		await change(async (id) => {
			if (id !== c.workspaceId) throw new UserError('study.sched.workspaceChanged');
			const saved = await saveParamSet(session.study, id, {
				w: c.w,
				source: c.source,
				labelled: c.labelled,
				logLoss: c.logLoss,
				baselineLogLoss: c.source === 'optimized' ? c.baselineLogLoss : undefined
			});
			await setActiveSet(session.study, id, saved.id);
			return saved.id;
		}, t('study.sched.changed'));
	}

	function discard(): void {
		candidate = null;
		result = null;
	}

	function use(setId: string | null): Promise<void> {
		return change(async (id) => {
			await setActiveSet(session.study, id, setId);
			return setId;
		}, t('study.sched.changed'));
	}

	function remove(setId: string): Promise<void> {
		return change(
			async (id) => {
				await deleteParamSet(session.study, id, setId);
				return undefined;
			},
			null,
			(before) =>
				(fsrs.pointer ?? null) !== before
					? t('study.sched.deletedActiveChanged')
					: null
		);
	}

	async function undoLast(): Promise<void> {
		const slot = undo;
		if (slot === null || locked || slot.workspaceId !== workspaceId) return;
		clearTimeout(undoTimer);
		busy = true;
		try {
			// Read the stored pointer again: another device may have moved it.
			await reloadData(slot.workspaceId);
			if (!shouldRestorePointer(fsrs.pointer ?? null, slot.wrote)) {
				actionError = t('study.sched.undoNoop');
				undo = null;
				return;
			}
			await setActiveSet(session.study, slot.workspaceId, slot.previousId);
			undo = null;
			candidate = null;
			await reloadData(slot.workspaceId);
		} catch (err) {
			actionError = errorText(err, t('study.store.undoFailed'));
		} finally {
			busy = false;
		}
	}

	function activeSetLabel(active: { source: string; createdAt: string; labelled?: number }): string {
		const day = active.createdAt.slice(0, 10);
		const label = active.source === 'optimized' ? t('study.sched.optimised', { day }) : t('study.sched.imported', { day });
		return active.labelled === undefined ? label : t('study.sched.withReviews', { count: active.labelled, label });
	}

	const activeLabel = $derived(
		fsrs.active === null ? t('study.sched.default') : activeSetLabel(fsrs.active)
	);
</script>

<svelte:head>
	<title>{pageTitle(t('study.sched.title'), t('study.setup.title'))}</title>
</svelte:head>

<div class="page-body page">
	<p><a href="/study">{t('study.sched.back')}</a></p>
	<h1>{t('study.sched.title')}</h1>

	{#if workspaceId === null}
		<p>{t('study.sched.noWorkspace')}</p>
	{:else if loading}
		<p role="status">{t('study.sched.loading')}</p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
		<Button onclick={() => load(workspaceId)}>{t('common.action.retry')}</Button>
	{:else}
		{#if problem}
			<p class="error" role="alert">{problem}</p>
		{/if}
		<p>
			{t('study.sched.active', { label: activeLabel })}
			{#if fsrs.active !== null}
				<Button disabled={locked} onclick={() => use(null)}>{t('study.sched.useDefaults')}</Button>
			{/if}
		</p>

		<OptimizePanel
			labelled={dataset.labelled}
			{running}
			{progress}
			{result}
			{activeFit}
			error={optimiseError}
			primary={candidate === null}
			onOptimise={optimise}
			onCancel={cancel}
		/>

		{#if candidate !== null}
			<PreviewPanel
				{preview}
				pending={previewPending}
				error={previewError}
				{check}
				busy={locked}
				fit={{ current: activeFit, candidate: candidate.fit }}
				source={candidate.source}
				onApply={apply}
				onDiscard={discard}
			/>
		{/if}

		<SavedSets
			sets={fsrs.sets}
			activeId={fsrs.active?.id ?? null}
			busy={locked}
			onUse={(id) => use(id)}
			onDelete={(id) => remove(id)}
			onDefaults={() => use(null)}
		/>

		<ImportExport activeW={fsrs.w} busy={locked} onImport={importWeights} />

		{#if actionError}
			<p class="error" role="alert">{actionError}</p>
		{/if}
	{/if}
</div>

<div class="toast-region" role="status" aria-live="polite">
	{#if undo}
		<div
			class="toast"
			role="presentation"
			onmouseenter={pauseUndoTimer}
			onmouseleave={startUndoTimer}
			onfocusin={pauseUndoTimer}
			onfocusout={startUndoTimer}
		>
			<span>{undo.text}</span>
			<Button disabled={locked} onclick={undoLast}>{t('common.action.undo')}</Button>
		</div>
	{/if}
</div>

<style>
	/* No second page container: .page-body owns the column and its margins (#106). */
	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.toast-region {
		position: fixed;
		inset: auto 0 calc(1rem + max(var(--bottom-bar-space, 0px), env(safe-area-inset-bottom, 0px))) 0;
		display: flex;
		justify-content: center;
		pointer-events: none;
		z-index: var(--layer-float);
	}

	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		background: var(--panel);
		color: var(--text);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		padding: var(--space-2) var(--space-4);
		box-shadow: var(--shadow-float);
	}
</style>
