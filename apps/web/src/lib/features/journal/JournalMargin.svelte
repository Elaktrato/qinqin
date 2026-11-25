<script lang="ts">
	import { isImeKey } from '$lib/ui/ime';
	// The journal's margin (#103): topic ideas while writing, corrections
	// after a review. Corrections are a list in text order; list-only and
	// missing ones follow under their own headings. Unboxed, hairlines only.
	import { t } from '$lib/i18n';
	import { correctionCounts, type Correction } from './corrections';
	import CorrectionNote from './CorrectionNote.svelte';
	import IdeasPanel from './IdeasPanel.svelte';
	import type { AiGate } from './editorLogic';

	let {
		mode,
		corrections,
		openId,
		onopen,
		workspaceId,
		gate,
		onstart,
		studyLang,
		explanationLang
	}: {
		mode: 'ideas' | 'corrections';
		corrections: Correction[];
		openId: string | null;
		onopen: (id: string | null) => void;
		workspaceId?: number;
		gate?: AiGate;
		onstart?: (title: string) => void;
		studyLang: string;
		explanationLang: string;
	} = $props();

	const counts = $derived(correctionCounts(corrections));
	const placed = $derived(corrections.filter((c) => c.state === 'placed'));
	const listOnly = $derived(corrections.filter((c) => c.state === 'listOnly'));
	const missing = $derived(corrections.filter((c) => c.state === 'missing'));

	function open(id: string | null): void {
		onopen(id);
		if (id !== null) scrollTo(id);
	}

	function scrollTo(id: string): void {
		const note = document.getElementById(`correction-${id}`);
		if (typeof note?.scrollIntoView === 'function') note.scrollIntoView({ block: 'nearest' });
	}

	// Opening a mark elsewhere (the text) brings its note into view.
	$effect(() => {
		const id = openId;
		if (id !== null) scrollTo(id);
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
	class="margin"
	aria-label={t('journal.margin.label')}
	onkeydown={(event) => {
		if (event.key === 'Escape' && openId !== null && !isImeKey(event)) {
			event.preventDefault();
			const id = openId;
			onopen(null);
			document.getElementById(`mark-${id}`)?.focus();
		}
	}}
>
	{#if mode === 'ideas' && workspaceId !== undefined && gate !== undefined && onstart !== undefined}
		<IdeasPanel {workspaceId} {gate} {onstart} title={t('journal.list.ideasToday')} {studyLang} {explanationLang} />
	{:else if mode === 'corrections'}
		<h3 class="heading">{t('journal.margin.corrections', { count: placed.length + listOnly.length })}</h3>
		{#if corrections.length > 0}
			<p class="counts">{t('journal.margin.mistakes', { count: counts.mistakes })} · {t('journal.margin.suggestions', { count: counts.suggestions })}</p>
		{:else}
			<p class="hint">{t('journal.annotations.none')}</p>
		{/if}
		{#if placed.length > 0}
			<div class="notes">
				{#each placed as correction (correction.annotation.id)}
					<CorrectionNote
						correction={correction}
						open={openId === correction.annotation.id}
						onopen={open}
						{explanationLang}
						{studyLang}
						id={`correction-${correction.annotation.id}`}
					/>
				{/each}
			</div>
		{/if}
		{#if listOnly.length > 0}
			<h4>{t('journal.margin.listOnly')}</h4>
			<div class="notes">
				{#each listOnly as correction (correction.annotation.id)}
					<CorrectionNote
						correction={correction}
						open={openId === correction.annotation.id}
						onopen={open}
						{explanationLang}
						{studyLang}
						id={`correction-${correction.annotation.id}`}
					/>
				{/each}
			</div>
		{/if}
		{#if missing.length > 0}
			<h4>{t('journal.annotations.gone')}</h4>
			<p class="hint">{t('journal.annotations.goneHint')}</p>
			<ul class="missing">
				{#each missing as correction (correction.annotation.id)}
					<li>
						<span lang={studyLang}>{correction.annotation.quote} → {correction.annotation.correction}</span>
						<p class="why" lang={explanationLang}>{correction.annotation.explanation}</p>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</aside>

<style>
	.margin {
		display: grid;
		gap: var(--space-2);
		align-content: start;
		min-width: 0;
	}
	.heading {
		margin: 0;
		font-size: var(--font-size-label);
		font-weight: var(--weight-strong);
		color: var(--readable-muted);
	}
	.counts,
	.hint {
		margin: 0;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	.notes {
		display: grid;
		gap: 0;
	}
	h4 {
		margin: var(--space-4) 0 0;
		font-size: var(--font-size-label);
		font-weight: var(--weight-strong);
		color: var(--readable-muted);
	}
	.missing {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--space-1);
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
</style>
