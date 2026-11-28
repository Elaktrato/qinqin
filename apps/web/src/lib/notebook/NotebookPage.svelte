<script lang="ts">
	// The mistake notebook (#227): what the learner got wrong in the current workspace, by group, newest first, and
	// "Practise my mistakes" (the notebook's drill items in one round, its due cards as a flashcards session, grammar
	// and course items through their own lesson or test). The rules are the core's (lib/studycore/notebook.ts); the
	// words and links are view.ts; this component only shows and records the marks.
	import { goto } from '$app/navigation';
	import { t } from '$lib/i18n';
	import { errorText } from '$lib/api/apiErrors';
	import { pageTitle } from '$lib/routing/pageTitle';
	import { setFrameTitle } from '$lib/frame/pageFrame.svelte';
	import { useSession } from '$lib/context/context';
	import { Button, Dialog, Section } from '$lib/ui';
	import { saveConfig } from '$lib/features/flashcards/session/session';
	import RoundView from '$lib/features/practice/RoundView.svelte';
	import { answerEvent } from '$lib/features/practice/answer';
	import type { DrillAnswerInput, RoundEntry } from '$lib/features/practice/types';
	import type { NotebookPayload } from '$lib/events/eventPayloads';
	import { loadNotebook, type NotebookData } from './load';
	import { markEvent } from './marks';
	import { cardSessionConfig } from './practise';
	import { LEAVE_AFTER } from '$lib/studycore/notebook';
	import { NOTEBOOK_HREF, PRACTISE_HREF, linkedItems, notebookCardIds, notebookSections, parseNotebookRoute, practiseRound } from './view';

	let { rest }: { rest: string } = $props();

	const session = useSession();
	const workspace = $derived(session.workspaces.current);
	const route = $derived(parseNotebookRoute(rest));

	let data = $state.raw<NotebookData | null>(null);
	let error = $state('');
	let actionError = $state('');
	let busy = $state(false);
	let confirmClear = $state(false);
	let status = $state('');
	// A new load after a mark or a finished round ("Practise again").
	let generation = $state(0);
	let seq = 0;

	$effect(() => {
		const ws = workspace;
		void rest;
		void generation;
		if (ws === null) return;
		const mine = ++seq;
		error = '';
		loadNotebook(session, ws).then(
			(loaded) => {
				if (mine === seq) data = loaded;
			},
			(err) => {
				if (mine === seq) error = errorText(err, t('study.notebook.loadFailed'));
			}
		);
	});

	const sections = $derived(data === null ? [] : notebookSections(data.items, data.ctx));
	const round = $derived(data === null ? [] : practiseRound(data.items, data.ctx));
	const cardCount = $derived(data === null ? 0 : notebookCardIds(data.items).length);
	const linked = $derived(data === null ? 0 : linkedItems(data.items).length);
	const title = $derived(route.view === 'practise' ? t('study.notebook.practise.title') : t('study.notebook.title'));

	setFrameTitle(() => title);

	async function mark(payload: NotebookPayload, done: string): Promise<void> {
		const ws = workspace;
		if (ws === null || busy) return;
		busy = true;
		actionError = '';
		status = '';
		const kept = await session.outbox.recordEvent(markEvent(ws.id, payload));
		busy = false;
		if (kept === null) {
			actionError = t('study.notebook.notSaved');
			return;
		}
		status = done;
		generation += 1;
	}

	function remove(key: string, what: string): void {
		void mark({ action: 'remove', item: key }, t('study.notebook.removed', { item: what }));
	}

	function clear(): void {
		confirmClear = false;
		void mark({ action: 'clear' }, t('study.notebook.cleared'));
	}

	function reviewCards(): void {
		if (data === null || data.dueCards.length === 0) return;
		saveConfig(cardSessionConfig(data.cardDecks, data.dueCards, NOTEBOOK_HREF));
		void goto('/study/session');
	}

	async function record(entry: RoundEntry, answer: DrillAnswerInput): Promise<boolean> {
		const ws = workspace;
		if (ws === null) return false;
		const kept = await session.outbox.recordEvent(answerEvent(ws.id, entry.drill, entry.item.key, answer.mode, answer.grade));
		return kept !== null;
	}
</script>

<svelte:head>
	<title>{pageTitle(route.view === 'practise' ? title : '', t('study.notebook.title'))}</title>
</svelte:head>

<div class="page-body notebook">
	{#if workspace === null}
		<h1>{t('study.notebook.title')}</h1>
		<p>{t('study.notebook.chooseWorkspace')}</p>
	{:else if error}
		<h1>{title}</h1>
		<p class="error" role="alert">{error}</p>
	{:else if data === null}
		<h1>{title}</h1>
		<p role="status">{t('common.loading')}</p>
	{:else if route.view === 'practise'}
		{#key generation}
			<RoundView {title} entries={round} drills={[...data.ctx.drills.values()]} {record} backHref={NOTEBOOK_HREF} onAgain={() => (generation += 1)} />
		{/key}
	{:else}
		<h1>{title}</h1>
		<p class="muted">{t('study.notebook.intro', { n: LEAVE_AFTER })}</p>
		<p class="status" role="status">{status}</p>
		{#if actionError}<p class="error" role="alert">{actionError}</p>{/if}
		{#if data.items.length === 0}
			<p>{t('study.notebook.empty')}</p>
		{:else}
			<Section title={t('study.notebook.practise.title')}>
				<div class="practise">
					{#if round.length > 0}
						<p>{t('study.notebook.practise.drills', { count: round.length })}</p>
						<Button variant="primary" href={PRACTISE_HREF}>{t('study.notebook.practise.start')}</Button>
					{/if}
					{#if data.dueCards.length > 0}
						<p>{t('study.notebook.practise.cardsDue', { count: data.dueCards.length })}</p>
						<Button onclick={reviewCards}>{t('study.notebook.practise.reviewCards')}</Button>
					{/if}
					{#if cardCount > data.dueCards.length}
						<p class="muted">{t('study.notebook.practise.cardsLater')}</p>
					{/if}
					{#if linked > 0}
						<p class="muted">{t('study.notebook.practise.linked')}</p>
					{/if}
				</div>
			</Section>
			{#each sections as section (section.group)}
				<Section title={section.title}>
					<ul class="items">
						{#each section.rows as row (row.key)}
							<li class="item">
								<div class="what">
									<span class="title" lang={row.inStudyLanguage ? workspace.language : undefined}>{row.title}</span>
									<span class="muted">{row.source}</span>
								</div>
								<p class="facts">
									<span>{row.wrong}</span>
									<span>{row.mistakes}</span>
									<span>{row.last}</span>
									{#if row.progress}<span class="progress">{row.progress}</span>{/if}
								</p>
								<div class="actions">
									{#if row.href}<Button variant="plain" href={row.href}>{row.hrefLabel}</Button>{/if}
									<Button
										variant="plain"
										disabled={busy}
										aria-label={t('study.notebook.removeLabel', { item: row.title })}
										onclick={() => remove(row.key, row.title)}>{t('common.action.remove')}</Button
									>
								</div>
							</li>
						{/each}
					</ul>
				</Section>
			{/each}
			<div class="clear">
				<Button tone="danger" disabled={busy} onclick={() => (confirmClear = true)}>{t('study.notebook.clear')}</Button>
			</div>
		{/if}
	{/if}
</div>

<Dialog bind:open={confirmClear} title={t('study.notebook.clearTitle')} description={t('study.notebook.clearText')}>
	{#snippet actions()}
		<Button onclick={() => (confirmClear = false)}>{t('common.action.cancel')}</Button>
		<Button variant="primary" tone="danger" onclick={clear}>{t('study.notebook.clearYes')}</Button>
	{/snippet}
</Dialog>

<style>
	.muted {
		color: var(--readable-muted);
	}
	.status:empty {
		display: none;
	}
	.practise {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.practise p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.item {
		padding-block: var(--space-3);
		min-width: 0;
	}
	.item + .item {
		border-top: 1px solid var(--hair);
	}
	.what {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
	}
	.title {
		font-size: var(--font-size-l);
		overflow-wrap: anywhere;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin: var(--space-1) 0;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.clear {
		margin-top: var(--space-4);
	}
</style>
