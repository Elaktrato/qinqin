<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatDate } from '$lib/i18n/format';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { aiErrorView, type AiErrorView } from './aiErrors';
	import { answeredBy } from './answeredBy';
	import Chip from '$lib/ui/Chip.svelte';
	import { requestSuggestions } from './api';
	import type { AiGate } from './editorLogic';
	import { loadProviderNames } from './providerNames';
	import { pollForReview } from './reviewPoll';
	import { getSuggestions } from './store';
	import type { Suggestions } from './types';

	let {
		workspaceId,
		gate,
		onstart,
		title = t('journal.ideas.title')
	}: { workspaceId: number; gate: AiGate; onstart: (title: string) => void; title?: string } = $props();

	const ws = untrack(() => workspaceId);
	const aborter = new AbortController();
	onDestroy(() => aborter.abort());

	let suggestions = $state<Suggestions | null>(null);
	let busy = $state(false);
	let status = $state('');
	let failure = $state<AiErrorView | null>(null);

	let names = $state<Map<string, string> | null>(null);
	const providerName = $derived(
		suggestions?.provider && names ? (names.get(suggestions.provider) ?? suggestions.provider) : undefined
	);

	onMount(() => {
		void loadProviderNames().then((m) => (names = m));
		getSuggestions(ws).then(
			(s) => (suggestions = s),
			() => {}
		);
	});

	async function ask(): Promise<void> {
		if (busy || !gate.enabled) return;
		busy = true;
		failure = null;
		status = t('journal.ideas.looking');
		const since = suggestions?.createdAt ?? '';
		try {
			suggestions = await requestSuggestions(ws, aborter.signal);
			status = t('journal.ideas.ready');
		} catch (err) {
			if (aborter.signal.aborted) return;
			const view = aiErrorView(err, 'ideas');
			if (view.poll) {
				status = t('journal.ideas.waiting');
				const late = await pollForReview(() => getSuggestions(ws), since, {
					signal: aborter.signal
				});
				if (aborter.signal.aborted) return;
				if (late) {
					suggestions = late;
					status = t('journal.ideas.ready');
					busy = false;
					return;
				}
			}
			status = '';
			failure = view;
		} finally {
			busy = false;
		}
	}

	function when(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? '' : formatDate(d);
	}
</script>

<section class="ideas" aria-labelledby="ideas-heading">
	<h2 id="ideas-heading">{title}</h2>
	<div class="bar">
		<button type="button" onclick={ask} disabled={busy || !gate.enabled}>
			{busy ? t('journal.ideas.working') : t('journal.ideas.get')}
		</button>
		{#if gate.hint}
			<span class="hint">
				{gate.hint}{#if gate.settingsLink}
					{' '}<a href="/settings?tab=ai">{t('journal.openAiSettings')}</a>{/if}
			</span>
		{/if}
	</div>
	<div class="live" aria-live="polite">{status}</div>
	{#if failure}
		<p class="error" role="alert">
			{failure.text}
			{#if failure.settingsLink}<a href="/settings?tab=ai">{t('journal.openAiSettings')}</a>{/if}
		</p>
	{/if}

	{#if suggestions && suggestions.items.length > 0}
		<p class="hint">
			{t('journal.ideas.from', { date: when(suggestions.createdAt) })}{#if suggestions.model}
				· {answeredBy(suggestions.model, providerName)}{/if}
		</p>
		<ul>
			{#each suggestions.items as item, i (i)}
				<li>
					<h3>{item.title}</h3>
					<p class="prompt">{item.prompt}</p>
					{#if item.words.length > 0}
						<ul class="chips" aria-label={t('journal.ideas.words')}>
							{#each item.words as w, j (j)}<li><Chip>{w}</Chip></li>{/each}
						</ul>
					{/if}
					<button type="button" class="secondary" onclick={() => onstart(item.title)}>
						{t('journal.ideas.start')}
						<span class="sr">: {item.title}</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if suggestions}
		<p class="hint">{t('journal.ideas.none')}</p>
	{/if}
</section>

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}

	.live {
		min-height: 1.4em;
	}

	.ideas > ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}

	.ideas > ul > li {
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.5rem;
		padding: 0.6rem 0.9rem;
	}

	h3 {
		margin: 0 0 0.25rem;
		font-size: 1.05rem;
		overflow-wrap: anywhere;
	}

	.prompt {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0;
		margin: 0.5rem 0;
	}

	.chips li {
		display: inline-flex;
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
