<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { Dictionary, Workspace } from '$lib/api/types';
	import { dictionaryHint } from '$lib/coverage';
	import { HIDDEN_DICTIONARIES_KEY, hiddenDictionaries } from '$lib/dictionaryVisibility';
	import { languageLabel } from '$lib/languages';
	import { setSettings } from '$lib/workspaces';

	// Inline panel choosing which dictionaries of the workspace's language
	// its entries and lookups show. `dictionaries` are already filtered to
	// the language. Saved as hidden ids in the workspace settings.
	let {
		workspace,
		dictionaries,
		admin,
		onclose
	}: {
		workspace: Workspace;
		dictionaries: Dictionary[];
		admin: boolean;
		onclose: () => void;
	} = $props();

	// The panel edits a draft seeded once from the props.
	// svelte-ignore state_referenced_locally
	const initialHidden = hiddenDictionaries(workspace);
	// svelte-ignore state_referenced_locally
	let shownIds = $state<number[]>(dictionaries.filter((d) => !initialHidden.has(d.id)).map((d) => d.id));
	let saving = $state(false);
	let error = $state('');
	let panel = $state<HTMLElement | null>(null);

	onMount(async () => {
		await tick();
		panel?.focus();
	});

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (saving) return;
		saving = true;
		error = '';
		try {
			// Ids of dictionaries not listed here (uninstalled, other language)
			// stay as they were, so a reinstall keeps the choice.
			const listed = new Set(dictionaries.map((d) => d.id));
			const kept = [...hiddenDictionaries(workspace)].filter((id) => !listed.has(id));
			const hidden = [...kept, ...dictionaries.filter((d) => !shownIds.includes(d.id)).map((d) => d.id)];
			await setSettings(workspace.id, { [HIDDEN_DICTIONARIES_KEY]: hidden });
			onclose();
		} catch (err) {
			error = err instanceof Error && err.message ? err.message : 'Could not save.';
		} finally {
			saving = false;
		}
	}

	function keydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onclose();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form
	class="panel"
	bind:this={panel}
	tabindex="-1"
	aria-label="Dictionaries shown in this workspace"
	onsubmit={save}
	onkeydown={keydown}
>
	<h4>Dictionaries shown in this workspace</h4>
	{#if dictionaries.length === 0}
		<p class="hint">{dictionaryHint(languageLabel(workspace.language), admin)}</p>
	{:else}
		{#each dictionaries as dictionary (dictionary.id)}
			<label class="choice">
				<input type="checkbox" value={dictionary.id} bind:group={shownIds} />
				<span>
					<span class="sr-only">Show in entries and lookups: </span>{dictionary.name}
					<span class="version">{dictionary.version}</span>
				</span>
			</label>
		{/each}
	{/if}
	<div class="actions">
		{#if dictionaries.length > 0}
			<button type="submit" class="primary" aria-busy={saving}>{saving ? 'Saving…' : 'Save'}</button>
		{/if}
		<button type="button" class="secondary" onclick={onclose}>Cancel</button>
	</div>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

<style>
	.panel {
		display: grid;
		gap: 0.4rem;
		margin-top: 0.5rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.5rem;
	}

	h4 {
		margin: 0;
		font-size: 0.9rem;
	}

	.choice {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
	}

	.version {
		opacity: 0.7;
		font-size: 0.8rem;
		margin-left: 0.25rem;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	button {
		font: inherit;
		min-height: 44px;
		padding: 0.4rem 0.8rem;
		border-radius: 0.4rem;
		cursor: pointer;
	}

	.primary {
		border: 0;
		background: #0b6bcb;
		color: #fff;
		font-weight: 600;
	}

	.secondary {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
	}

	.hint {
		margin: 0;
		opacity: 0.8;
	}

	.error {
		margin: 0;
		color: #c62828;
		font-weight: 600;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
