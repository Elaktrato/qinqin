<script lang="ts">
	// The Practice area (docs/contracts/drills/): the drills that apply to the workspace language, a drill's round and
	// the round across drills. The page loads the answers and the items; the views only show and ask.
	import { t } from '$lib/i18n';
	import { errorText } from '$lib/api/apiErrors';
	import { pageTitle } from '$lib/routing/pageTitle';
	import { setFrameTitle } from '$lib/frame/pageFrame.svelte';
	import { useSession } from '$lib/context/context';
	import { answerEvent } from './answer';
	import { availableDrills, deviceStorage } from './drills';
	import { loadPractice, type PracticeData } from './load';
	import { drillSummary, roundOf, weakestRound } from './overview';
	import PracticeList from './PracticeList.svelte';
	import RoundView from './RoundView.svelte';
	import { parsePracticeRoute, practiceHref } from './route';
	import type { DrillAnswerInput, RoundEntry } from './types';

	let { rest }: { rest: string } = $props();

	const session = useSession();
	const workspace = $derived(session.workspaces.current);
	const drills = $derived(workspace === null ? [] : availableDrills(workspace.language, deviceStorage()));
	const route = $derived(parsePracticeRoute(rest, drills.map((d) => d.id)));
	const drill = $derived(route.view === 'drill' || route.view === 'drillWeakest' ? drills.find((d) => d.id === route.drill) : undefined);

	let data = $state.raw<PracticeData | null>(null);
	let error = $state('');
	// A new round of the same route ("Practise again") loads again: its picks see the answers just given.
	let generation = $state(0);
	let seq = 0;

	$effect(() => {
		const ws = workspace;
		const list = drills;
		void rest;
		void generation;
		if (ws === null) return;
		const mine = ++seq;
		data = null;
		error = '';
		loadPractice(session, ws, list).then(
			(loaded) => {
				if (mine === seq) data = loaded;
			},
			(err) => {
				if (mine === seq) error = errorText(err, t('practice.loadFailed'));
			}
		);
	});

	const now = $derived(data === null ? 0 : Date.now());
	const summaries = $derived(
		data === null
			? []
			: drills.map((d) => {
					const items = data!.items.get(d.id) ?? [];
					return {
						drill: d,
						items,
						answers: data!.answers.filter((a) => a.drill === d.id),
						summary: drillSummary(
							d.id,
							items.map((i) => i.key),
							data!.states,
							now
						)
					};
				})
	);
	const weakest = $derived(
		data === null ? [] : weakestRound(drills.map((d) => ({ drill: d.id, items: data!.items.get(d.id) ?? [] })), data.states, now, data.clock)
	);
	const entries = $derived.by((): RoundEntry[] => {
		if (data === null) return [];
		if (route.view === 'weakest') return weakest;
		if (route.view === 'drillWeakest' && drill !== undefined)
			return weakestRound([{ drill: drill.id, items: data.items.get(drill.id) ?? [] }], data.states, now, data.clock);
		if (drill !== undefined) return roundOf(drill.id, data.items.get(drill.id) ?? [], data.states, now, data.clock);
		return [];
	});
	const roundTitle = $derived(
		route.view === 'weakest'
			? t('practice.round.weakestTitle')
			: route.view === 'drillWeakest' && drill !== undefined
				? t('practice.round.drillWeakestTitle', { drill: drill.title })
				: (drill?.title ?? '')
	);

	setFrameTitle(() => (route.view === 'list' ? t('practice.title') : roundTitle || t('practice.title')));

	async function record(entry: RoundEntry, answer: DrillAnswerInput): Promise<boolean> {
		const ws = workspace;
		if (ws === null) return false;
		// Write-ahead in the outbox: an answer that cannot be sent now is sent later.
		const kept = await session.outbox.recordEvent(answerEvent(ws.id, entry.drill, entry.item.key, answer.mode, answer.grade));
		return kept !== null;
	}
</script>

<svelte:head>
	<title>{pageTitle(route.view === 'list' ? '' : roundTitle, t('practice.title'))}</title>
</svelte:head>

<div class="page-body practice">
	{#if workspace === null}
		<h1>{t('practice.title')}</h1>
		<p>{t('practice.chooseWorkspace')}</p>
	{:else if error}
		<h1>{t('practice.title')}</h1>
		<p class="error" role="alert">{error}</p>
	{:else if data === null}
		<h1>{route.view === 'list' ? t('practice.title') : roundTitle}</h1>
		<p role="status">{t('common.loading')}</p>
	{:else if route.view === 'list'}
		<PracticeList {summaries} weakestCount={weakest.length} states={data.states} {now} />
	{:else}
		{#key `${rest}:${generation}`}
			<RoundView
				title={roundTitle}
				{entries}
				{drills}
				{record}
				backHref={practiceHref({ view: 'list' })}
				onAgain={() => (generation += 1)}
			/>
		{/key}
	{/if}
</div>
