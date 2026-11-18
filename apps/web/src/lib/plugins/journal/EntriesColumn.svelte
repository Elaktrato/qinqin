<script lang="ts">
	// The journal's entries column (#103): New entry (the view's primary on
	// the list), the entries as hairline rows with their date and title, a
	// dot for a reviewed entry, Ideas for today, and the photo/settings
	// actions at the bottom. The list is the cached per-workspace store.
	import { t } from '$lib/i18n';
	import { formatDay } from '$lib/i18n/format';
	import { studyLang } from '$lib/i18n/lang';
	import { onMount } from 'svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { photoObjectUrl } from './api';
	import { entryLabel } from './entryLabel';
	import { journalEntriesFor } from './journalEntries.svelte';
	import { clearDraft, loadDraft } from './photoDraftStore';
	import { journalHref } from './route';

	let {
		workspaceId,
		workspaceName,
		language,
		currentId = null,
		primaryNew = true,
		onideas
	}: {
		workspaceId: number;
		workspaceName: string;
		language: string;
		currentId?: string | null;
		primaryNew?: boolean;
		onideas: () => void;
	} = $props();

	const store = $derived(journalEntriesFor(workspaceId));
	let resumable = $state(false);

	$effect(() => {
		void store.load();
	});

	// A saved photo draft is only offered while its photo still exists.
	async function checkDraft(): Promise<void> {
		const draft = loadDraft(workspaceId);
		if (!draft) return;
		try {
			URL.revokeObjectURL(await photoObjectUrl(draft.photoId));
			resumable = true;
		} catch {
			clearDraft();
		}
	}

	onMount(() => {
		void checkDraft();
	});

	function date(day: string): string {
		return formatDay(day, { weekday: 'short', day: 'numeric', month: 'short' });
	}
</script>

<div class="column">
	<Button variant={primaryNew ? 'primary' : 'secondary'} href={journalHref({ view: 'new' })}
		>{t('journal.list.new')}</Button
	>

	{#if store.loading && store.items.length === 0}
		<p role="status">{t('journal.list.loading')}</p>
	{:else if store.error}
		<p class="error" role="alert">{store.error}</p>
		<Button variant="secondary" onclick={() => store.load(true)}>{t('journal.list.retry')}</Button>
	{:else if store.items.length === 0}
		<p class="hint">{t('journal.list.empty')}</p>
	{:else}
		<ul class="entries">
			{#each store.items as entry (entry.id)}
				{@const current = currentId === entry.id}
				<li>
					<a
						class="row"
						class:current
						href={journalHref({ view: 'entry', id: entry.id })}
						aria-current={current ? 'page' : undefined}
					>
						<span class="date">{date(entry.date)}</span>
						<span class="title" lang={studyLang(language)}>{entryLabel(entry)}</span>
						{#if store.reviewed.has(entry.id)}
							<span class="reviewed-dot" title={t('journal.list.reviewed')} aria-hidden="true"></span>
							<span class="visually-hidden">{t('journal.list.reviewed')}</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<button type="button" class="ideas" onclick={onideas}>{t('journal.list.ideasToday')}</button>

	<div class="foot">
		<Button variant="secondary" href={journalHref({ view: 'photo' })}>{t('journal.list.upload')}</Button>
		{#if resumable}
			<Button variant="secondary" href={journalHref({ view: 'photo' })}>{t('journal.list.resume')}</Button>
		{/if}
		<IconButton
			href={journalHref({ view: 'settings' })}
			icon="settings"
			label={t('journal.list.settings')}
		/>
	</div>
</div>

<style>
	.column {
		display: grid;
		gap: var(--space-3);
		align-content: start;
		min-width: 0;
	}
	.entries {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
	}
	.entries li + li .row {
		border-top: 1px solid var(--hair);
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: var(--space-1) var(--space-2);
		align-items: center;
		padding: var(--space-2);
		border-radius: var(--radius);
		color: var(--text);
		text-decoration: none;
	}
	.row:hover {
		background: var(--raised);
	}
	.row.current {
		background: var(--selected-wash);
		box-shadow: inset 2px 0 0 var(--accent);
	}
	.date {
		grid-column: 1;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	.title {
		grid-column: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.reviewed-dot {
		grid-column: 2;
		grid-row: 1 / span 2;
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: var(--good);
	}
	.hint,
	.error {
		margin: 0;
		color: var(--readable-muted);
	}
	.error {
		color: var(--readable-bad);
	}
	.ideas {
		justify-self: start;
		padding: var(--space-1) var(--space-2);
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}
	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
</style>
