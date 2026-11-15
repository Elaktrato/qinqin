<script lang="ts">
	import { onMount } from 'svelte';
	import type { Workspace } from '$lib/api/types';
	import { codePoints } from './entryDraft';
	import { EXPLANATION_LANGUAGES } from './languages';
	import { journalHref } from './route';
	import { getJournalSettings, saveJournalSettings } from './store';

	let { workspace }: { workspace: Workspace } = $props();

	const MAX_GUIDANCE = 2000;

	let guidance = $state('');
	let language = $state('en');
	let loading = $state(true);
	let saving = $state(false);
	let status = $state('');
	let error = $state('');
	let heading = $state<HTMLHeadingElement>();

	const count = $derived(codePoints(guidance));
	const tooLong = $derived(count > MAX_GUIDANCE);

	onMount(async () => {
		try {
			const s = await getJournalSettings(workspace.id);
			guidance = s.guidance;
			language = s.explanationLanguage;
		} catch {
			error = 'Could not load the settings. Try again later.';
		} finally {
			loading = false;
		}
		heading?.focus();
	});

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (saving || tooLong) return;
		saving = true;
		error = '';
		status = 'Saving…';
		try {
			await saveJournalSettings(workspace.id, { guidance, explanationLanguage: language });
			status = 'Saved';
		} catch {
			status = '';
			error = 'Could not save the settings. Try again.';
		} finally {
			saving = false;
		}
	}
</script>

<p><a href={journalHref({ view: 'list' })}>← Journal</a></p>
<h1 bind:this={heading} tabindex="-1">Journal settings for {workspace.name}</h1>

{#if loading}
	<p role="status">Loading…</p>
{:else}
	<form onsubmit={save}>
		<label>
			<span>Correction guidance</span>
			<textarea
				bind:value={guidance}
				rows="6"
				aria-describedby="guidance-help guidance-count"
				placeholder="For example: I am a beginner, keep explanations short."
			></textarea>
		</label>
		<p id="guidance-help" class="hint">
			Preferences for the corrections. They cannot change the languages or the format of the review.
		</p>
		<p id="guidance-count" class:error={tooLong}>
			{count.toLocaleString('en')} / {MAX_GUIDANCE.toLocaleString('en')}
		</p>

		<label>
			<span>Explanation language</span>
			<select bind:value={language}>
				{#each EXPLANATION_LANGUAGES as l (l.code)}
					<option value={l.code}>{l.label}</option>
				{/each}
			</select>
		</label>

		<div class="bar">
			<button type="submit" disabled={saving || tooLong}>Save</button>
			<span class="live" aria-live="polite">{status}</span>
		</div>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</form>

	<p><a href="/settings?tab=ai">API key and model: Settings → AI →</a></p>
{/if}

<style>
	h1:focus {
		outline: none;
	}

	form {
		display: grid;
		gap: 0.5rem;
		max-width: 34rem;
	}

	label {
		display: grid;
		gap: 0.3rem;
		font-weight: 600;
	}

	textarea,
	select {
		font: inherit;
		font-weight: 400;
		padding: 0.5rem 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		box-sizing: border-box;
		width: 100%;
	}

	p {
		margin: 0.25rem 0;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
</style>
