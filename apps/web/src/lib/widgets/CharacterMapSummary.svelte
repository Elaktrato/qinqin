<script lang="ts">
	import { hasCharacterMap } from '$lib/languages/profiles';
	import StageBar from '$lib/stats/map/StageBar.svelte';
	import { t } from '$lib/i18n';
	import Msg from '$lib/ui/Msg.svelte';
	import { onContextStale } from '$lib/studycore/currentContext';
	import { characterSummary, loadCharacterMapData, withLegacyWritten } from '$lib/stats/characterMap';
	import { errorText } from '$lib/api/apiErrors';
	import type { SectionStats } from '$lib/studycore/charGroups';
	import { STAGE_INFO, formatCount, learnedSummary } from '$lib/studycore/mapGrid';
	import { MASTERY_THRESHOLD } from '$lib/studycore/mastery';
	import Button from '$lib/ui/Button.svelte';
	import WidgetCard from './WidgetCard.svelte';
	import { WidgetLoad } from './widgetLoad.svelte';
	import type { WidgetStatus } from './types';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	// The character map's summary tile (core, Han languages only): how
	// many of the language's characters are learned, the stage bar and a
	// link to the full map under Stats.

	interface Shown {
		stats: SectionStats;
		stale: boolean;
		unresolved: number;
	}
	let noWorkspace = $state(false);
	let notHan = $state(false);
	// The last map summary of this workspace shows at once on a revisit (#290).
	const shown = new WidgetLoad<Shown>(session, 'character-map-summary', session.workspaces.current?.id ?? null);
	const stats = $derived(shown.value?.stats ?? null);
	const stale = $derived(shown.value?.stale ?? false);
	const unresolved = $derived(shown.value?.unresolved ?? 0);

	const workspace = $derived(session.workspaces.current);
	const workspaceId = $derived(workspace?.id ?? null);
	const language = $derived(workspace?.language ?? '');

	const status = $derived<WidgetStatus>(
		noWorkspace
			? 'no-workspace'
			: shown.loading
				? 'loading'
				: shown.error
					? 'error'
					: notHan || (stats?.total ?? 0) === 0
						? 'empty'
						: 'ready'
	);

	async function load(id: number | null, lang: string, force = false): Promise<void> {
		noWorkspace = id === null;
		notHan = id !== null && !hasCharacterMap(lang);
		if (id === null || notHan) {
			shown.clear();
			return;
		}
		await shown.run(
			id,
			async (show) => {
				const data = await loadCharacterMapData(session, id, lang, { force });
				const now = new Date();
				const first = {
					stats: characterSummary(data.list.chars, data.cards, data.reviews, now, data.w, data.clock),
					stale: data.list.stale === true,
					unresolved: 0
				};
				if (!data.cards.some((card) => card.written === undefined)) return first;
				// The counts show now; cards from before written snapshots resolve behind them.
				show(first);
				const filled = await withLegacyWritten(session, data.cards);
				return {
					...first,
					stats: characterSummary(data.list.chars, filled.cards, data.reviews, now, data.w, data.clock),
					unresolved: filled.unresolved
				};
			},
			(err) => errorText(err, t('widgets.characters.loadFailed'))
		);
	}

	$effect(() => {
		void load(workspaceId, language);
	});
	$effect(() => onContextStale(session.zone, () => void load(workspaceId, language)));
</script>

<div class="tile">
	<WidgetCard
		title={t('widgets.characters.title')}
		headingId="character-map-summary-heading"
		{status}
		noWorkspaceText={t('widgets.characters.noWorkspace')}
		loadingText={t('widgets.characters.loading')}
		error={shown.error}
		stale={shown.stale}
		onretry={() => void load(workspaceId, language, true)}
		emptyText={notHan
			? t('widgets.characters.notHan')
			: t('widgets.characters.noneInstalled')}
	>
		{#snippet actions()}
			{#if status === 'ready'}
				<Button variant="plain" href="/stats/characters">{t('widgets.characters.open')}</Button>
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
		--st-unknown-edge: var(--muted);
		--st-fresh-bar: var(--mastery-1);
		--st-learning-bar: var(--mastery-2);
		--st-mature-bar: var(--mastery-3);
		--st-learned-bar: var(--mastery-4);
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

	/* Not studied: no fill, a dashed outline (as the map's own legend). */
	.st-unknown {
		background: transparent;
		border-style: dashed;
		border-color: var(--st-unknown-edge);
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
