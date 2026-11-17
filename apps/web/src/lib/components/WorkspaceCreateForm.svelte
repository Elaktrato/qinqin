<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
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
			return t('app.workspaces.create.exists');
		}
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	onMount(async () => {
		try {
			installed = await listLanguages();
		} catch (err) {
			languagesError = message(err, t('app.workspaces.create.languagesFailed'));
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
			error = message(err, t('app.workspaces.create.failed'));
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
<form class="create-workspace" onsubmit={submit} onkeydown={keydown} aria-label={t('app.workspaces.create.label')}>
	<div class="fields">
		<label for="{idPrefix}-language">{t('app.workspaces.create.language')}</label>
		<select
			id="{idPrefix}-language"
			bind:this={select}
			bind:value={language}
			disabled={options.length === 0}
			required
		>
			{#if options.length === 0}
				<option value="">{loadingLanguages ? t('common.loading') : t('app.workspaces.create.noLanguages')}</option>
			{/if}
			{#each options as option (option.code)}
				<option value={option.code}>
					{option.hasDictionary ? option.label : t('app.workspaces.create.noDictionary', { language: option.label })}
				</option>
			{/each}
		</select>

		<label for="{idPrefix}-name"
			><Msg key="app.workspaces.create.name"
				>{#snippet optional(text: string)}<span class="optional">{text}</span>{/snippet}</Msg
			></label
		>
		<input
			id="{idPrefix}-name"
			bind:this={nameInput}
			bind:value={name}
			maxlength="40"
			autocomplete="off"
			placeholder={t('app.workspaces.create.namePlaceholder')}
		/>
	</div>

	<div class="actions">
		<!-- Not disabled while creating: a disabled button drops keyboard
		     focus to <body>; submit() ignores repeats instead. -->
		<button type="submit" class="primary" disabled={!language} aria-busy={creating}>
			{creating ? t('app.workspaces.create.creating') : t('app.workspaces.create.submit')}
		</button>
		{#if onCancel}
			<button type="button" class="secondary" onclick={onCancel}>{t('common.action.cancel')}</button>
		{/if}
	</div>

	{#if languagesError}
		<p class="error" role="alert">{languagesError}</p>
	{:else if !loadingLanguages && options.length === 0}
		<p class="hint">{t('app.workspaces.create.nothingInstalled')}</p>
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
		color: var(--readable-muted);
	}

	select,
	input {
		font: inherit;
		min-width: 0;
		padding: 0.35rem 0.5rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: var(--panel);
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
		background: var(--accent);
		color: var(--on-accent);
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
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.hint {
		margin: 0;
		color: var(--readable-muted);
	}
</style>
