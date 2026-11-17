<script lang="ts">
	import { t } from '$lib/i18n';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import IdeasPanel from './IdeasPanel.svelte';
	import type { AiGate } from './editorLogic';
	import { photoObjectUrl } from './api';
	import { clearDraft, loadDraft } from './photoDraftStore';
	import { listEntries, getReview } from './store';
	import { journalHref, newEntryHref } from './route';
	import { entryLabel } from './entryLabel';
	import type { JournalEntry } from './types';

	let {
		workspaceId,
		workspaceName,
		gate
	}: { workspaceId: number; workspaceName: string; gate: AiGate } = $props();

	let entries = $state<JournalEntry[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let reviewed = $state<Record<string, boolean>>({});
	let resumable = $state(false);
	let heading = $state<HTMLHeadingElement>();

	// Reviews are only read to show a badge: a few at a time, newest
	// entries first, and a failure just leaves the badge off.
	const BADGE_LIMIT = 40;
	const PARALLEL = 4;

	async function loadBadges(list: JournalEntry[], alive: () => boolean): Promise<void> {
		const queue = list.slice(0, BADGE_LIMIT);
		async function worker(): Promise<void> {
			for (let e = queue.shift(); e && alive(); e = queue.shift()) {
				try {
					const review = await getReview(workspaceId, e.id);
					if (alive() && review) reviewed[e.id] = true;
				} catch {
					// no badge
				}
			}
		}
		await Promise.all(Array.from({ length: PARALLEL }, worker));
	}

	async function load(): Promise<void> {
		loading = true;
		loadError = '';
		try {
			entries = await listEntries(workspaceId);
			loading = false;
			void loadBadges(entries, () => true);
		} catch {
			loadError = t('journal.list.loadFailed');
			loading = false;
		}
	}

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
		void load();
	});
</script>

<h1 bind:this={heading} tabindex="-1">{t('journal.title')} <span class="ws">· {workspaceName}</span></h1>

<div class="actions">
	<a class="button primary" href={journalHref({ view: 'new' })}>{t('journal.list.new')}</a>
	<a class="button secondary" href={journalHref({ view: 'photo' })}>{t('journal.list.upload')}</a>
	{#if resumable}
		<a class="button secondary" href={journalHref({ view: 'photo' })}>{t('journal.list.resume')}</a>
	{/if}
	<a class="button secondary" href={journalHref({ view: 'settings' })}>{t('journal.list.settings')}</a>
</div>

{#if loading}
	<p role="status">{t('journal.list.loading')}</p>
{:else if loadError}
	<p class="error" role="alert">{loadError}</p>
	<button type="button" class="secondary" onclick={load}>{t('journal.list.retry')}</button>
{:else if entries.length === 0}
	<p class="hint">
		{t('journal.list.empty')}
	</p>
{:else}
	<ul class="entries">
		{#each entries as entry (entry.id)}
			<li>
				<a href={journalHref({ view: 'entry', id: entry.id })}>
					<span class="date">{entry.date}</span>
					<span class="title">{entryLabel(entry)}</span>
					{#if reviewed[entry.id]}<span class="badge">{t('journal.list.reviewed')}</span>{/if}
				</a>
			</li>
		{/each}
	</ul>
{/if}

<IdeasPanel {workspaceId} {gate} onstart={(title) => goto(newEntryHref(title))} />

<style>
	h1 {
		font-size: 1.6rem;
	}

	h1:focus {
		outline: none;
	}

	.ws {
		font-weight: 400;
		opacity: 0.7;
		font-size: 1rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		margin: 1rem 0;
	}

	a.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0 1rem;
		border-radius: 0.4rem;
		text-decoration: none;
		font-weight: 600;
		box-sizing: border-box;
	}

	a.button.primary {
		background: #0b6bcb;
		color: #fff;
	}

	a.button.secondary {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		color: inherit;
	}

	.entries {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.entries a {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
		min-height: 2.75rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
		color: inherit;
		text-decoration: none;
		box-sizing: border-box;
	}

	.entries a:hover {
		background: color-mix(in srgb, currentColor 6%, transparent);
	}

	.date {
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}

	.title {
		font-weight: 600;
		flex: 1 1 10rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.badge {
		font-size: 0.8rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
	}
</style>
