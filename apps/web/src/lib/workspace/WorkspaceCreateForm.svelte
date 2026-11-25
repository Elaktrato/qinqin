<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { ApiError } from '$lib/api/client';
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { listLanguages } from '$lib/api/languages';
	import type { Language, Workspace } from '$lib/api/types';
	import { languageOptions } from '$lib/languages';
	import { Button, Field, Select } from '$lib/ui';
	import { useSession } from '$lib/context/context';
	const session = useSession();

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
	let select = $state<HTMLSelectElement | undefined>(undefined);
	let nameInput = $state<HTMLInputElement | undefined>(undefined);

	const options = $derived(languageOptions(installed, session.workspaces.list));
	const selectOptions = $derived(
		options.length === 0
			? [{ value: '', label: loadingLanguages ? t('common.loading') : t('app.workspaces.create.noLanguages') }]
			: options.map((option) => ({
					value: option.code,
					label: option.hasDictionary
						? option.label
						: t('app.workspaces.create.noDictionary', { language: option.label })
				}))
	);

	// Keep a valid choice once the options are known.
	$effect(() => {
		if (options.length > 0 && !options.some((option) => option.code === language)) {
			language = options[0].code;
		}
	});

	onMount(async () => {
		try {
			installed = await listLanguages();
		} catch (err) {
			languagesError = errorText(err, t('app.workspaces.create.languagesFailed'));
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
			const created = await session.workspaces.create(language, name);
			name = '';
			onCreated?.(created);
		} catch (err) {
			error =
				err instanceof ApiError && err.code === 'workspace_exists'
					? t('app.workspaces.create.exists')
					: errorText(err, t('app.workspaces.create.failed'));
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
		<Select
			label={t('app.workspaces.create.language')}
			id="{idPrefix}-language"
			bind:element={select}
			bind:value={language}
			options={selectOptions}
			disabled={options.length === 0}
			required
		/>

		<Field
			label={t('app.workspaces.create.name').replace(/<[^>]+>/g, '')}
			id="{idPrefix}-name"
			bind:element={nameInput}
			bind:value={name}
			maxlength={40}
			autocomplete="off"
			placeholder={t('app.workspaces.create.namePlaceholder')}
		/>
	</div>

	<div class="actions">
		<!-- Not disabled while creating: a disabled button drops keyboard
		     focus to <body>; submit() ignores repeats instead. -->
		<Button type="submit" variant="primary" disabled={!language} busy={creating}>
			{creating ? t('app.workspaces.create.creating') : t('app.workspaces.create.submit')}
		</Button>
		{#if onCancel}
			<Button type="button" onclick={onCancel}>{t('common.action.cancel')}</Button>
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
		gap: var(--space-3);
		max-width: 28rem;
	}

	.fields {
		display: grid;
		gap: var(--space-3);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.hint {
		margin: 0;
		color: var(--readable-muted);
	}
</style>
