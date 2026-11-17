<script lang="ts">
	import StageBar from '$lib/components/map/StageBar.svelte';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { onContextStale } from '$lib/study/currentContext';
	import { usesHan } from '$lib/languages';
	import { characterSummary, loadCharacterMapData, withLegacyWritten } from '$lib/stats/characterMap';
	import { errorMessage } from '$lib/stats/errors';
	import type { SectionStats } from '$lib/study/charGroups';
	import { STAGE_INFO, formatCount, learnedSummary } from '$lib/study/mapGrid';
	import { MASTERY_THRESHOLD } from '$lib/study/mastery';
	import { workspaces } from '$lib/workspaces';
	import WidgetCard from './WidgetCard.svelte';
	import type { WidgetStatus } from './types';

	// The character map's summary tile (core, Han languages only): how
	// many of the language's characters are learned, the stage bar and a
	// link to the full map under Stats.

	let stats = $state.raw<SectionStats | null>(null);
	let stale = $state(false);
	let unresolved = $state(0);
	let loading = $state(true);
	let error = $state('');
	let noWorkspace = $state(false);
	let notHan = $state(false);

	let requestSeq = 0;

	const workspace = $derived($workspaces.current);
	const workspaceId = $derived(workspace?.id ?? null);
	const language = $derived(workspace?.language ?? '');

	const status = $derived<WidgetStatus>(
		noWorkspace
			? 'no-workspace'
			: loading
				? 'loading'
				: error
					? 'error'
					: notHan || (stats?.total ?? 0) === 0
						? 'empty'
						: 'ready'
	);

	async function load(id: number | null, lang: string, force = false): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		error = '';
		noWorkspace = false;
		notHan = false;
		stale = false;
		unresolved = 0;

		if (id === null) {
			stats = null;
			noWorkspace = true;
			loading = false;
			return;
		}
		if (!usesHan(lang)) {
			// The registry hides the tile for such languages; this is a guard.
			stats = null;
			notHan = true;
			loading = false;
			return;
		}

		try {
			const data = await loadCharacterMapData(id, lang, { force });
			if (seq !== requestSeq) return;
			const now = new Date();
			stats = characterSummary(data.list.chars, data.cards, data.reviews, now, data.w, data.clock);
			stale = data.list.stale === true;
			loading = false;

			// Legacy cards without a written snapshot: resolve them like the
			// map does, then count once more.
			if (data.cards.some((card) => card.written === undefined)) {
				const filled = await withLegacyWritten(data.cards);
				if (seq !== requestSeq) return;
				stats = characterSummary(data.list.chars, filled.cards, data.reviews, now, data.w, data.clock);
				unresolved = filled.unresolved;
			}
		} catch (err) {
			if (seq !== requestSeq) return;
			stats = null;
			error = errorMessage(err, t('widgets.characters.loadFailed'));
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	$effect(() => {
		void load(workspaceId, language);
	});
	$effect(() => onContextStale(() => void load(workspaceId, language)));
</script>

<div class="tile">
	<WidgetCard
		title={t('widgets.characters.title')}
		headingId="character-map-summary-heading"
		{status}
		noWorkspaceText={t('widgets.characters.noWorkspace')}
		loadingText={t('widgets.characters.loading')}
		{error}
		onretry={() => void load(workspaceId, language, true)}
		emptyText={notHan
			? t('widgets.characters.notHan')
			: t('widgets.characters.noneInstalled')}
	>
		{#snippet actions()}
			{#if status === 'ready'}
				<a class="open" href="/stats/characters">{t('widgets.characters.open')}</a>
			{/if}
		{/snippet}

		{#if stats !== null}
			<p class="total">
				<strong>{learnedSummary(stats.learned, stats.total)}</strong>
			</p>
			<StageBar byStage={stats.byStage} size="large" />
			<ul class="legend">
				{#each STAGE_INFO as item (item.stage)}
					<li>
						<span class="swatch st-{item.stage}" aria-hidden="true"></span>
						{item.label} <strong>{formatCount(stats.byStage[item.stage])}</strong>
					</li>
				{/each}
			</ul>
			<p class="note">{t('widgets.characters.learnedRule', { threshold: MASTERY_THRESHOLD })}</p>
			{#if stale}
				<p class="note" role="status">
					<Msg key="widgets.characters.stale">{#snippet code(text: string)}<code>{text}</code>{/snippet}</Msg>
				</p>
			{/if}
			{#if unresolved > 0}
				<p class="note" role="status">
					{t('widgets.characters.unresolved', { count: unresolved })}
				</p>
			{/if}
		{/if}
	</WidgetCard>
</div>

<style>
	/* The map's stage colours (routes/stats/characters), for StageBar and the
	   legend: the single-hue mastery ramp (design §9), the legend names each. */
	.tile {
		height: 100%;

		--st-edge: var(--hair);
		--st-unknown-bg: color-mix(in srgb, currentColor 4%, transparent);
		--st-unknown-bar: var(--mastery-0);
		--st-fresh-bar: var(--mastery-1);
		--st-learning-bar: var(--mastery-2);
		--st-mature-bar: var(--mastery-3);
		--st-learned-bar: var(--mastery-4);
	}

	.open {
		font-size: 0.8rem;
		padding: 0.2rem 0.65rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		color: var(--reading-accent);
		font-weight: 600;
		text-decoration: none;
	}


	.total {
		margin: 0.9rem 0 0.5rem;
		font-size: 0.95rem;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		margin: 0.6rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.85rem;
	}

	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.swatch {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 0.15rem;
		border: 1px solid var(--st-edge);
	}

	.st-unknown {
		background: var(--st-unknown-bar);
	}

	.st-fresh {
		background: var(--st-fresh-bar);
	}

	.st-learning {
		background: var(--st-learning-bar);
	}

	.st-mature {
		background: var(--st-mature-bar);
	}

	.st-learned {
		background: var(--st-learned-bar);
	}

	.note {
		margin: 0.6rem 0 0;
		font-size: 0.8rem;
		color: var(--readable-muted);
	}
</style>
