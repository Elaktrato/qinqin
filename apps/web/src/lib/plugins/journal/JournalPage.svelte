<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getAiStatus } from '$lib/api/ai';
	import { workspaces } from '$lib/workspaces';
	import { aiBanner as bannerOf } from '$lib/settings/aiSettingsView';
	import { aiButtonGate } from './editorLogic';
	import EntryEditor from './EntryEditor.svelte';
	import EntryList from './EntryList.svelte';
	import PhotoImport from './PhotoImport.svelte';
	import JournalSettingsView from './JournalSettings.svelte';
	import { getCapabilities } from './api';
	import { journalHref, parseJournalRoute } from './route';
	import type { Capabilities } from './types';

	let { rest }: { rest: string } = $props();

	const route = $derived(parseJournalRoute(rest));
	const workspace = $derived($workspaces.current);

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
</script>

<svelte:head>
	<title>{pageTitle('Journal')}</title>
</svelte:head>

<main class="journal">
	{#if !workspace}
		<h1>Journal</h1>
		<p>Choose a workspace first.</p>
	{:else if route.view === 'settings'}
		<JournalSettingsView {workspace} />
	{:else if route.view === 'photo'}
		{#key workspace.id}
			<PhotoImport workspaceId={workspace.id} language={workspace.language} {capabilities} />
		{/key}
	{:else if route.view === 'entry' || route.view === 'new'}
		{#key workspace.id}
			<EntryEditor
				workspaceId={workspace.id}
				entryId={route.view === 'entry' ? route.id : null}
				initialTitle={route.view === 'new' ? newTitle : ''}
				{aiAvailable}
				{aiBanner}
			/>
		{/key}
	{:else}
		{#key workspace.id}
			<EntryList workspaceId={workspace.id} workspaceName={workspace.name} gate={ideasGate} />
		{/key}
	{/if}
</main>

<style>
	.journal {
		max-width: 48rem;
	}

	.journal :global(button),
	.journal :global(a.button),
	.journal :global(select),
	.journal :global(input:not([type='checkbox'])) {
		min-height: 2.75rem;
	}

	/* The shape of every journal button except the inline underlines. */
	.journal :global(button:where(:not(.annot))) {
		padding: 0 1rem;
		border: 1px solid transparent;
		border-radius: 0.4rem;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.journal :global(button:where(:not(.annot, .secondary))) {
		background: #0b6bcb;
		color: #fff;
	}

	.journal :global(button:disabled) {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.journal :global(.secondary) {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
		font-weight: 500;
	}

	.journal :global(.error) {
		color: #c62828;
		font-weight: 600;
	}

	.journal :global(.danger) {
		color: #c62828;
	}

	.journal :global(.hint) {
		opacity: 0.8;
	}

	.journal :global(:focus-visible) {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}

	@media (prefers-color-scheme: dark) {
		.journal :global(.error),
		.journal :global(.danger) {
			color: #ff8a80;
		}
	}

	@media (max-width: 30rem) {
		.journal {
			padding-left: 1rem;
			padding-right: 1rem;
		}
	}
</style>
