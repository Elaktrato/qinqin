<script lang="ts">
	// Settings → Study → "What you already know" (#74): declare a level range
	// as known, take the placement test, and undo a declaration. A declaration
	// is a set of the reader's `known:` marks with a batch id (lib/study/
	// knownMarks.ts); it creates no card and changes no review history.
	import { getSchemes } from '$lib/api/schemes';
	import type { Scheme } from '$lib/api/types';
	import { newUlid } from '$lib/events/ulid';
	import { t } from '$lib/i18n';
	import { formatDay } from '$lib/i18n/format';
	import { useSession } from '$lib/context/context';
	import { setKnownMarks } from '$lib/study/commands/keyed';
	import { getStudyData } from '$lib/study/data';
	import type { KnownBatch } from '$lib/study/knownMarks';
	import { Button, Section, Select } from '$lib/ui';
	import {
		declarations,
		newMarks,
		nonEmptyLevels,
		rangeEntries,
		scopeLabel,
		type Declaration
	} from './declare';
	import { declarableSchemes, loadSchemeLevels, type SchemeLevels } from './levels';
	import PlacementTest from './PlacementTest.svelte';

	const session = useSession();

	let schemes = $state.raw<Scheme[] | null>(null);
	let loadFailed = $state(false);
	let schemeId = $state('');
	let loaded = $state.raw<{ scheme: Scheme; data: SchemeLevels } | null>(null);
	let levelsFailed = $state(false);
	let upTo = $state('');
	let marked = $state.raw<ReadonlySet<number>>(new Set());
	// Whether `marked` is what the server holds: a declaration must not be built on a guess, or it would
	// re-stamp the learner's own marks with its batch id and Undo would delete them.
	let marksState = $state<'loading' | 'ready' | 'error'>('loading');
	let progress = $state<{ done: number; total: number } | null>(null);
	// A declaration that failed midway: its retry reuses the batch id, so the rows already written and the
	// rest are one declaration, not two.
	let failedBatch = $state.raw<{ ws: number; batch: KnownBatch } | null>(null);
	let declared = $state.raw<Declaration[]>([]);
	let mode = $state<'idle' | 'confirm' | 'test'>('idle');
	let pending = $state<{ position: number; source: KnownBatch['source'] } | null>(null);
	let busy = $state(false);
	let message = $state('');
	let error = $state('');
	let seq = 0;

	const workspace = $derived(session.workspaces.current);
	const workspaceId = $derived(workspace?.id ?? null);
	const language = $derived(workspace?.language ?? '');

	const scheme = $derived(schemes?.find((s) => String(s.id) === schemeId) ?? null);
	const levels = $derived(loaded === null ? [] : nonEmptyLevels(loaded.data.levels));
	const position = $derived(upTo === '' ? 0 : Number(upTo));
	const fresh = $derived(newMarks(rangeEntries(levels, position), marked));
	const schemeOptions = $derived.by(() => {
		const list = schemes ?? [];
		const names = new Map<string, number>();
		for (const s of list) names.set(s.name, (names.get(s.name) ?? 0) + 1);
		return list.map((s) => ({
			value: String(s.id),
			label: (names.get(s.name) ?? 0) > 1 && s.packId ? `${s.name} · ${s.packId}` : s.name
		}));
	});
	const noEntries = $derived(loaded !== null && levels.length === 0);
	const levelOptions = $derived(levels.map((level, i) => ({ value: String(i + 1), label: level.name })));

	$effect(() => {
		const lang = language;
		schemes = null;
		loadFailed = false;
		getSchemes().then(
			(all) => {
				if (lang !== language) return;
				schemes = declarableSchemes(lang, all);
				schemeId = schemes[0] === undefined ? '' : String(schemes[0].id);
			},
			() => {
				if (lang === language) loadFailed = true;
			}
		);
	});

	$effect(() => {
		const chosen = scheme;
		const mine = ++seq;
		loaded = null;
		levelsFailed = false;
		upTo = '';
		if (chosen === null) return;
		loadSchemeLevels(session.caches.levelItems, chosen).then(
			(data) => {
				if (mine !== seq) return;
				loaded = { scheme: chosen, data };
				const first = nonEmptyLevels(data.levels);
				upTo = first.length > 0 ? String(Math.min(2, first.length)) : '';
			},
			() => {
				if (mine === seq) levelsFailed = true;
			}
		);
	});

	async function refresh(force = false): Promise<void> {
		const ws = workspaceId;
		if (ws === null) return;
		marksState = 'loading';
		try {
			const data = await getStudyData(session.study, ws, { force });
			if (ws !== workspaceId) return;
			marked = new Set(data.known ?? []);
			declared = declarations(data.knownDeclared ?? []);
			marksState = 'ready';
		} catch {
			if (ws === workspaceId) marksState = 'error';
		}
	}

	$effect(() => {
		void workspaceId;
		mode = 'idle';
		message = '';
		error = '';
		failedBatch = null;
		marked = new Set();
		declared = [];
		void refresh();
	});

	const ready = $derived(marksState === 'ready' && !noEntries);

	function ask(source: KnownBatch['source'], at: number): void {
		pending = { position: at, source };
		message = '';
		error = '';
		mode = 'confirm';
	}

	async function declare(): Promise<void> {
		const ws = workspaceId;
		const target = pending;
		if (busy || marksState !== 'ready') return;
		if (ws === null || target === null || loaded === null) return;
		const chosen = levels[target.position - 1];
		if (chosen === undefined) return;
		const ids = newMarks(rangeEntries(levels, target.position), marked);
		const scope = scopeLabel(loaded.scheme.name, chosen.name);
		const retry = failedBatch !== null && failedBatch.ws === ws && failedBatch.batch.source === target.source && failedBatch.batch.scope === scope;
		const batch: KnownBatch = retry ? failedBatch!.batch : { id: newUlid(), source: target.source, scope };
		busy = true;
		error = '';
		progress = { done: 0, total: ids.length };
		try {
			await setKnownMarks(session.study, ws, ids, true, { batch, onProgress: (done, total) => (progress = { done, total }) });
			failedBatch = null;
			message = t('settings.known.done', { count: ids.length });
		} catch {
			failedBatch = { ws, batch };
			error = t('settings.known.failed');
		} finally {
			busy = false;
			progress = null;
			mode = 'idle';
			pending = null;
			await refresh(true);
		}
	}

	async function undo(declaration: Declaration): Promise<void> {
		const ws = workspaceId;
		if (ws === null || busy) return;
		busy = true;
		message = '';
		error = '';
		try {
			await setKnownMarks(session.study, ws, declaration.entryIds, false);
			message = t('settings.known.undone');
		} catch {
			error = t('settings.known.undoFailed');
		} finally {
			busy = false;
			await refresh(true);
		}
	}

	const sourceLabel = (source: KnownBatch['source']): string =>
		source === 'placement' ? t('settings.known.sourcePlacement') : t('settings.known.sourceRange');
	const day = (iso: string): string => (iso === '' ? '' : formatDay(iso.slice(0, 10)));
</script>

<Section title={t('settings.known.title')} headingId="known" focusable>
	<p class="hint">{t('settings.known.hint')}</p>

	{#if loadFailed}
		<p class="error" role="alert">{t('settings.known.loadFailed')}</p>
	{:else if schemes === null}
		<p class="hint">{t('settings.known.loadingLevels')}</p>
	{:else if schemes.length === 0}
		<p class="hint">{t('settings.known.noSchemes')}</p>
	{:else}
		<div class="form">
			<Select label={t('settings.known.scheme')} bind:value={schemeId} options={schemeOptions} disabled={busy || mode === 'test'} />
			{#if levelsFailed}
				<p class="error" role="alert">{t('settings.known.loadFailed')}</p>
			{:else if loaded === null}
				<p class="hint">{t('settings.known.loadingLevels')}</p>
			{:else if mode === 'test'}
				<PlacementTest
					{levels}
					entries={loaded.data.entries}
					unit={loaded.scheme.unit === 'character' ? 'character' : 'word'}
					{language}
					{marked}
					{busy}
					onconfirm={(at) => {
						// The result screen is the confirmation: its button names the count.
						pending = { position: at, source: 'placement' };
						void declare();
					}}
					oncancel={() => (mode = 'idle')}
				/>
			{:else}
				{#if marksState === 'error'}
					<p class="error" role="alert">{t('settings.known.marksFailed')}</p>
					<div class="row">
						<Button onclick={() => refresh(true)} data-testid="known-reload">{t('settings.known.retryLoad')}</Button>
					</div>
				{:else if marksState === 'loading'}
					<p class="hint">{t('settings.known.loadingMarks')}</p>
				{:else if noEntries}
					<p class="hint" data-testid="known-no-entries">{t('settings.known.noEntries')}</p>
				{/if}
				{#if mode !== 'confirm'}
					<Select label={t('settings.known.upTo')} bind:value={upTo} options={levelOptions} disabled={busy} />
					<p class="hint" aria-live="polite">
						{fresh.length === 0 ? t('settings.known.nothingNew') : t('settings.known.preview', { count: fresh.length })}
					</p>
				{/if}
				{#if mode === 'confirm' && pending !== null}
					<div class="confirm" role="group" aria-label={t('settings.known.mark')}>
						<p>
							<strong>{levels[pending.position - 1]?.name ?? ''}</strong>
							{t('settings.known.confirmText', { count: newMarks(rangeEntries(levels, pending.position), marked).length })}
						</p>
						<div class="row">
							<Button variant="primary" {busy} disabled={busy || !ready} onclick={declare} data-testid="known-confirm">{t('settings.known.confirm')}</Button>
							<Button disabled={busy} onclick={() => (mode = 'idle')}>{t('common.action.cancel')}</Button>
						</div>
						{#if progress !== null}
							<p class="hint" role="status" data-testid="known-progress">{t('settings.known.progress', { done: progress.done, total: progress.total })}</p>
						{/if}
					</div>
				{:else}
					<div class="row">
						<Button variant="primary" disabled={busy || !ready || fresh.length === 0} onclick={() => ask('range', position)} data-testid="known-mark">
							{t('settings.known.mark')}
						</Button>
						<Button disabled={busy || !ready} onclick={() => (mode = 'test')} data-testid="placement-start">
							{t('settings.known.startTest')}
						</Button>
					</div>
					<p class="hint">{t('settings.known.testHint')}</p>
				{/if}
			{/if}
		</div>
	{/if}

	{#if message}<p class="note" role="status">{message}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<h3 class="list-title">{t('settings.known.listTitle')}</h3>
	{#if declared.length === 0}
		<p class="hint">{t('settings.known.listEmpty')}</p>
	{:else}
		<ul class="declarations">
			{#each declared as declaration (declaration.id)}
				<li>
					<span>
						<strong>{declaration.scope}</strong>
						<span class="hint">
							{t('settings.known.listMeta', {
								source: sourceLabel(declaration.source),
								date: day(declaration.createdAt),
								count: t('settings.known.listCount', { count: declaration.entryIds.length })
							})}
						</span>
					</span>
					<Button variant="plain" disabled={busy} onclick={() => undo(declaration)}>{t('common.action.undo')}</Button>
				</li>
			{/each}
		</ul>
	{/if}
</Section>

<style>
	.hint {
		margin: 0;
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}
	.form {
		display: grid;
		gap: var(--space-2);
		max-width: 28rem;
		margin-top: var(--space-2);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.confirm p {
		margin: 0 0 var(--space-2);
	}
	.note,
	.error {
		margin: var(--space-2) 0 0;
	}
	.error {
		color: var(--readable-bad);
	}
	.list-title {
		margin: var(--space-4) 0 var(--space-1);
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
	}
	.declarations {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}
	.declarations li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.declarations li > span {
		display: grid;
	}
</style>
