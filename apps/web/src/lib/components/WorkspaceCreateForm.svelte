<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { ApiError } from '$lib/api/client';
	import { listLanguages } from '$lib/api/languages';
	import type { Language, Workspace } from '$lib/api/types';
	import { languageOptions } from '$lib/languages';
	import { create, workspaces } from '$lib/workspaces';

	// Creates a workspace from an installed language (or one the user
	// already has) with an optional name. Shared by the header picker,
	// the settings page and the no-workspace empty state.
	let {
		idPrefix,
		autofocus = false,
		onCreated,
		onCancel
	}: {
		idPrefix: string;
		autofocus?: boolean;
		onCreated?: (workspace: Workspace) => void;
		onCancel?: () => void;
	} = $props();

	let installed = $state<Language[]>([]);
	let loadingLanguages = $state(true);
	let languagesError = $state('');
	let language = $state('');
	let name = $state('');
	let creating = $state(false);
	let error = $state('');
	let select = $state<HTMLSelectElement | null>(null);
	let nameInput = $state<HTMLInputElement | null>(null);

	const options = $derived(languageOptions(installed, $workspaces.list));

	// Keep a valid choice once the options are known.
	$effect(() => {
		if (options.length > 0 && !options.some((option) => option.code === language)) {
			language = options[0].code;
		}
	});

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.status === 409) {
			return 'A workspace with this language and name already exists. Pick another name.';
		}
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	onMount(async () => {
		try {
			installed = await listLanguages();
		} catch (err) {
			languagesError = message(err, 'Could not load the languages.');
		} finally {
			loadingLanguages = false;
		}
		if (autofocus) {
			await tick();
			if (select && !select.disabled) select.focus();
			else nameInput?.focus();
		}
	});

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!language || creating) return;
		creating = true;
		error = '';
		try {
			const created = await create(language, name);
			name = '';
			onCreated?.(created);
		} catch (err) {
			error = message(err, 'Could not create workspace.');
		} finally {
			creating = false;
		}
	}

	function keydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && onCancel) {
			event.preventDefault();
			event.stopPropagation();
			onCancel();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form class="create-workspace" onsubmit={submit} onkeydown={keydown} aria-label="New workspace">
	<div class="fields">
		<label for="{idPrefix}-language">Language</label>
		<select
			id="{idPrefix}-language"
			bind:this={select}
			bind:value={language}
			disabled={options.length === 0}
			required
		>
			{#if options.length === 0}
				<option value="">{loadingLanguages ? 'Loading…' : 'No languages'}</option>
			{/if}
			{#each options as option (option.code)}
				<option value={option.code}>
					{option.hasDictionary ? option.label : `${option.label} (no dictionary installed)`}
				</option>
			{/each}
		</select>

		<label for="{idPrefix}-name">Name <span class="optional">(optional)</span></label>
		<input
			id="{idPrefix}-name"
			bind:this={nameInput}
			bind:value={name}
			maxlength="40"
			autocomplete="off"
			placeholder="e.g. Novels"
		/>
	</div>

	<div class="actions">
		<!-- Not disabled while creating: a disabled button drops keyboard
		     focus to <body>; submit() ignores repeats instead. -->
		<button type="submit" class="primary" disabled={!language} aria-busy={creating}>
			{creating ? 'Creating…' : 'Create workspace'}
		</button>
		{#if onCancel}
			<button type="button" class="secondary" onclick={onCancel}>Cancel</button>
		{/if}
	</div>

	{#if languagesError}
		<p class="error" role="alert">{languagesError}</p>
	{:else if !loadingLanguages && options.length === 0}
		<p class="hint">No dictionary data is installed yet, so there is no language to choose.</p>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</form>

<style>
	.create-workspace {
		display: grid;
		gap: 0.6rem;
	}

	.fields {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 0.45rem 0.6rem;
	}

	label {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.optional {
		font-weight: 400;
		opacity: 0.7;
	}

	select,
	input {
		font: inherit;
		min-width: 0;
		padding: 0.35rem 0.5rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: Canvas;
		color: inherit;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	button {
		font: inherit;
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

	.primary:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.secondary {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
	}

	.error {
		margin: 0;
		color: #c62828;
		font-weight: 600;
	}

	.hint {
		margin: 0;
		opacity: 0.75;
	}
</style>
