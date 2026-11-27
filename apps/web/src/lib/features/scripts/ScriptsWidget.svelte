<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { formatNumber } from '$lib/i18n/format';
	import { writingSystemsOf } from '$lib/languages/profiles';
	import Button from '$lib/ui/Button.svelte';
	import WidgetCard from '$lib/widgets/WidgetCard.svelte';
	import { WidgetLoad } from '$lib/widgets/widgetLoad.svelte';
	import type { WidgetStatus } from '$lib/widgets/types';
	import { useSession } from '$lib/context/context';
	import { deriveProgress, summarise, type Summary } from './progress';
	import { systemLabel } from './labels';
	import { systemsFor } from './packs';
	import { readPending, mergeLog } from './pending';
	import type { StudyEventBody } from '$lib/api/types';

	// How much of each writing system of the workspace's language is known (the trainer's own progress).
	const session = useSession();

	// The last progress of this workspace shows at once on a revisit (#290).
	const shown = new WidgetLoad<{ id: string; summary: Summary }[]>(session, 'scripts', session.workspaces.current?.id ?? null);
	const rows = $derived(shown.value ?? []);

	const workspace = $derived(session.workspaces.current);
	const status = $derived<WidgetStatus>(
		workspace === null
			? 'no-workspace'
			: shown.loading
				? 'loading'
				: shown.error
					? 'error'
					: rows.every((r) => r.summary.known + r.summary.learning === 0)
						? 'empty'
						: 'ready'
	);

	async function load(force = false): Promise<void> {
		const ws = workspace;
		if (ws === null) return;
		await shown.run(
			ws.id,
			async () => {
				const log = await session.events.load(ws.id, { force });
				let pending: StudyEventBody[] = [];
				try {
					pending = readPending(localStorage, ws.id);
				} catch {
					// No storage: the stored log alone.
				}
				const map = deriveProgress(mergeLog(log, pending));
				const now = Date.now();
				return systemsFor(writingSystemsOf(ws.language)).map((s) => ({ id: s.id, summary: summarise(s.items, map, now) }));
			},
			(err) => errorText(err, t('scripts.widget.loadFailed'))
		);
	}

	$effect(() => {
		void workspace?.id;
		void load();
	});
	// An answer posted in the trainer drops the cached log: read again.
	$effect(() => session.events.onChange((id) => id === workspace?.id && void load()));
</script>

<WidgetCard
	title={t('scripts.widget.title')}
	headingId="scripts-widget-heading"
	{status}
	noWorkspaceText={t('scripts.widget.noWorkspace')}
	loadingText={t('scripts.widget.loading')}
	error={shown.error}
	stale={shown.stale}
	onretry={() => void load(true)}
	emptyText={t('scripts.widget.empty')}
>
	{#snippet actions()}
		<Button variant="plain" href="/scripts">{t('scripts.widget.open')}</Button>
	{/snippet}

	<ul class="rows">
		{#each rows as row (row.id)}
			<li>
				<span class="name">{systemLabel(row.id)}</span>
				<span class="count"
					>{t('scripts.summary.known', {
						known: formatNumber(row.summary.known),
						total: formatNumber(row.summary.total)
					})}</span
				>
			</li>
		{/each}
	</ul>
</WidgetCard>

<style>
	.rows {
		margin: var(--space-3) 0 0;
		padding: 0;
		list-style: none;
	}

	.rows li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		padding-block: var(--space-1);
		border-bottom: 1px solid var(--hair);
	}

	.count {
		font-variant-numeric: tabular-nums;
		color: var(--readable-muted);
	}
</style>
