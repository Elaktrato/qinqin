<script lang="ts">
	import { onMount } from 'svelte';
	import { aiErrorView, type AiErrorView } from './aiErrors';
	import { requestSuggestions } from './api';
	import type { AiGate } from './editorLogic';
	import { pollForReview } from './reviewPoll';
	import { getSuggestions } from './store';
	import type { Suggestions } from './types';

	let {
		workspaceId,
		gate,
		onstart
	}: { workspaceId: number; gate: AiGate; onstart: (title: string) => void } = $props();

	let suggestions = $state<Suggestions | null>(null);
	let busy = $state(false);
	let status = $state('');
	let failure = $state<AiErrorView | null>(null);

	onMount(() => {
		getSuggestions(workspaceId).then(
			(s) => (suggestions = s),
			() => {}
		);
	});

	async function ask(): Promise<void> {
		if (busy || !gate.enabled) return;
		busy = true;
		failure = null;
		status = 'Looking for ideas… (this can take a minute)';
		const since = suggestions?.createdAt ?? '';
		try {
			suggestions = await requestSuggestions(workspaceId);
			status = 'Ideas ready.';
		} catch (err) {
			const view = aiErrorView(err, 'ideas');
			if (view.poll) {
				status = 'Still waiting for the answer…';
				const late = await pollForReview(() => getSuggestions(workspaceId), since);
				if (late) {
					suggestions = late;
					status = 'Ideas ready.';
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
		return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
	}
</script>

<section class="ideas" aria-labelledby="ideas-heading">
	<h2 id="ideas-heading">Ideas</h2>
	<div class="bar">
		<button type="button" onclick={ask} disabled={busy || !gate.enabled}>
			{busy ? 'Working…' : 'Get ideas'}
		</button>
		{#if gate.hint}
			<span class="hint">
				{gate.hint}{#if gate.settingsLink}
					{' '}<a href="/settings?tab=ai">Open Settings → AI</a>{/if}
			</span>
		{/if}
	</div>
	<div class="live" aria-live="polite">{status}</div>
	{#if failure}
		<p class="error" role="alert">
			{failure.text}
			{#if failure.settingsLink}<a href="/settings?tab=ai">Open Settings → AI</a>{/if}
		</p>
	{/if}

	{#if suggestions && suggestions.items.length > 0}
		<p class="hint">From {when(suggestions.createdAt)}</p>
		<ul>
			{#each suggestions.items as item, i (i)}
				<li>
					<h3>{item.title}</h3>
					<p class="prompt">{item.prompt}</p>
					{#if item.words.length > 0}
						<ul class="chips" aria-label="Words to try">
							{#each item.words as w, j (j)}<li>{w}</li>{/each}
						</ul>
					{/if}
					<button type="button" class="secondary" onclick={() => onstart(item.title)}>
						Start an entry
						<span class="sr">: {item.title}</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if suggestions}
		<p class="hint">No ideas came back. Try again.</p>
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
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 999px;
		padding: 0.1rem 0.65rem;
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
