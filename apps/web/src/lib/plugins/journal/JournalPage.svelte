<script lang="ts">
	import { t } from '$lib/i18n';
	import { pageTitle } from '$lib/pageTitle';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { getAiStatus } from '$lib/api/ai';
	import { aiBanner as bannerOf } from '$lib/settings/aiSettingsView';
	import { aiButtonGate } from './editorLogic';
	import EntryEditor from './EntryEditor.svelte';
	import EntriesColumn from './EntriesColumn.svelte';
	import JournalMargin from './JournalMargin.svelte';
	import CorrectionSheet from './CorrectionSheet.svelte';
	import { studyLang } from '$lib/i18n/lang';
	import { PHONE_MEDIA_QUERY } from '$lib/frame/breakpoint';
	import Button from '$lib/ui/Button.svelte';
	import PhotoImport from './PhotoImport.svelte';
	import JournalSettingsView from './JournalSettings.svelte';
	import { getCapabilities } from './api';
	import { journalHref, parseJournalRoute } from './route';
	import type { Capabilities } from './types';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	let { rest }: { rest: string } = $props();

	const route = $derived(parseJournalRoute(rest));
	const workspace = $derived(session.workspaces.current);

	// What the AI buttons may do, from the server's capabilities. null while loading.
	let capabilities = $state<Capabilities | null>(null);
	let capError = $state(false);

	const aiAvailable = $derived(capabilities ? capabilities.ai.available : capError ? false : null);
	const aiBanner = $derived(capabilities ? bannerOf(capabilities.ai) : null);
	const ideasGate = $derived(
		aiButtonGate({ available: aiAvailable, banner: aiBanner, chars: 1, forReview: false })
	);

	let seq = 0;
	$effect(() => {
		const id = workspace?.id;
		capabilities = null;
		capError = false;
		if (id === undefined) return;
		const mine = ++seq;
		getCapabilities(id)
			.then((c) => {
				if (mine === seq) capabilities = c;
			})
			.catch(() => getAiStatus().then(
				(ai) => {
					if (mine === seq) capabilities = { ai, ocr: { available: false, languageReady: false, language: '' } };
				},
				() => {
					if (mine === seq) capError = true;
				}
			));
	});

	// An entry belongs to one workspace: switching the workspace in the
	// header while one is open goes back to the list.
	let openedIn: number | undefined;
	$effect(() => {
		const id = workspace?.id;
		if (route.view === 'entry' || route.view === 'new' || route.view === 'photo') {
			if (openedIn !== undefined && id !== undefined && id !== openedIn) {
				void goto(journalHref({ view: 'list' }), { replaceState: true });
			}
			openedIn = id;
		} else {
			openedIn = undefined;
		}
	});

	const newTitle = $derived(page.url.searchParams.get('title') ?? '');

	let phone = $state(false);
	let ideasOpen = $state(false);
	let listMargin = $state<HTMLElement | null>(null);

	onMount(() => {
		if (typeof matchMedia !== 'function') return;
		const mq = matchMedia(PHONE_MEDIA_QUERY);
		phone = mq.matches;
		const change = (event: MediaQueryListEvent): void => {
			phone = event.matches;
		};
		mq.addEventListener?.('change', change);
		return () => mq.removeEventListener?.('change', change);
	});

	function openIdeas(): void {
		if (phone) ideasOpen = true;
		else if (typeof listMargin?.scrollIntoView === 'function') listMargin.scrollIntoView({ block: 'start' });
	}

	function startIdea(title: string): void {
		ideasOpen = false;
		void goto(`/p/journal/new?title=${encodeURIComponent(title.trim())}`);
	}

	function openEntryIdeas(): void {
		const margin = document.querySelector('.margin-col');
		if (typeof margin?.scrollIntoView === 'function') margin.scrollIntoView({ block: 'start' });
	}
</script>

<svelte:head>
	<title>{pageTitle(t('journal.title'))}</title>
</svelte:head>

<div class="page-body journal">
	{#if !workspace}
		<h1>{t('journal.title')}</h1>
		<p>{t('journal.chooseWorkspace')}</p>
	{:else if route.view === 'settings'}
		<JournalSettingsView {workspace} />
	{:else if route.view === 'photo'}
		{#key workspace.id}
			<PhotoImport workspaceId={workspace.id} language={workspace.language} {capabilities} />
		{/key}
	{:else if route.view === 'entry' || route.view === 'new'}
		<h1 class="visually-hidden">{t('journal.title')}</h1>
		<a class="all-entries" href={journalHref({ view: 'list' })}>{t('journal.list.allEntries')}</a>
		<div class="journal-grid entry">
			<div class="entries-col">
				{#key workspace.id}
					<EntriesColumn
						workspaceId={workspace.id}
						workspaceName={workspace.name}
						language={workspace.language}
						currentId={route.view === 'entry' ? route.id : null}
						primaryNew={false}
						onideas={openEntryIdeas}
					/>
				{/key}
			</div>
			{#key workspace.id}
				<EntryEditor
					workspaceId={workspace.id}
					entryId={route.view === 'entry' ? route.id : null}
					initialTitle={route.view === 'new' ? newTitle : ''}
					{aiAvailable}
					{aiBanner}
					language={workspace.language}
				/>
			{/key}
		</div>
	{:else}
		<h1 class="visually-hidden">{t('journal.title')}</h1>
		<div class="journal-grid list">
			<div class="entries-col">
				{#key workspace.id}
					<EntriesColumn
						workspaceId={workspace.id}
						workspaceName={workspace.name}
						language={workspace.language}
						currentId={null}
						primaryNew={true}
						onideas={openIdeas}
					/>
				{/key}
			</div>
			<div class="empty-page">
				<p>{t('journal.list.pick')}</p>
				<Button variant="secondary" href={journalHref({ view: 'new' })}>{t('journal.list.new')}</Button>
			</div>
			{#if !phone}
				<div class="list-margin" bind:this={listMargin}>
					{#key workspace.id}
						<JournalMargin
							mode="ideas"
							corrections={[]}
							openId={null}
							onopen={() => {}}
							workspaceId={workspace.id}
							gate={ideasGate}
							onstart={startIdea}
							studyLang={studyLang(workspace.language) ?? workspace.language}
							explanationLang="en"
						/>
					{/key}
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if ideasOpen && workspace}
	<CorrectionSheet
		mode="ideas"
		corrections={[]}
		openId={null}
		onopen={() => {}}
		onclose={() => (ideasOpen = false)}
		workspaceId={workspace.id}
		gate={ideasGate}
		onstart={startIdea}
		studyLang={studyLang(workspace.language) ?? workspace.language}
		explanationLang="en"
	/>
{/if}

<style>
	.journal {
		max-width: 76rem;
	}
	.journal-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
		align-items: start;
	}
	.entries-col,
	.list-margin,
	.empty-page {
		min-width: 0;
	}
	.empty-page {
		display: grid;
		gap: var(--space-3);
		align-content: start;
		justify-items: start;
		max-width: 38em;
	}
	.all-entries {
		display: none;
		margin-bottom: var(--space-3);
		color: var(--readable-muted);
	}
	@media (max-width: 44.99rem) {
		.journal-grid.list .empty-page,
		.journal-grid.list .list-margin,
		.journal-grid.entry .entries-col {
			display: none;
		}
	}
	@media (min-width: 45rem) {
		.journal-grid.list {
			grid-template-columns: 13rem minmax(0, 1fr);
		}
		.journal-grid.list .empty-page {
			display: none;
		}
		.journal-grid.entry .entries-col {
			display: none;
		}
		.entries-col {
			border-inline-end: 1px solid var(--hair);
			padding-inline-end: var(--space-3);
		}
		.list-margin {
			border-inline-start: 1px solid var(--hair);
			padding-inline-start: var(--space-3);
		}
		.all-entries {
			display: inline-block;
		}
	}
	@media (min-width: 62.5rem) {
		.journal-grid.list {
			grid-template-columns: 13rem minmax(0, 1fr) 16rem;
		}
		.journal-grid.entry {
			grid-template-columns: 13rem minmax(0, 1fr);
		}
		.journal-grid.list .entries-col,
		.journal-grid.entry .entries-col {
			display: block;
		}
		.all-entries {
			display: none;
		}
	}
</style>
