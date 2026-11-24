<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/i18n';
	import type { Dictionary, Workspace } from '$lib/api/types';
	import { dictionaryHint } from '$lib/languages/coverage';
	import { HIDDEN_DICTIONARIES_KEY, hiddenDictionaries } from '$lib/workspace/dictionaryVisibility';
	import { languageLabel } from '$lib/languages';
	import { Button } from '$lib/ui';
	import { useSession } from '$lib/context/context';
	const session = useSession();

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
			await session.workspaces.setSettings(workspace.id, { [HIDDEN_DICTIONARIES_KEY]: hidden });
			onclose();
		} catch (err) {
			error = errorText(err, t('settings.dictionaries.saveFailed'));
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
	aria-label={t('settings.dictionaries.title')}
	onsubmit={save}
	onkeydown={keydown}
>
	<h4>{t('settings.dictionaries.title')}</h4>
	{#if dictionaries.length === 0}
		<p class="hint">{dictionaryHint(languageLabel(workspace.language), admin)}</p>
	{:else}
		{#each dictionaries as dictionary (dictionary.id)}
			<label class="choice">
				<input type="checkbox" value={dictionary.id} bind:group={shownIds} />
				<span>
					<span class="sr-only">{t('settings.dictionaries.show')}</span>{dictionary.name}
					<span class="version">{dictionary.version}</span>
				</span>
			</label>
		{/each}
	{/if}
	<div class="actions">
		{#if dictionaries.length > 0}
			<Button type="submit" busy={saving}>{saving ? t('common.state.saving') : t('common.action.save')}</Button>
		{/if}
		<Button type="button" onclick={onclose}>{t('common.action.cancel')}</Button>
	</div>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

<style>
	.panel {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-3);
		padding-block: var(--space-3);
		padding-inline-start: var(--space-3);
		border-inline-start: 1px solid var(--hair);
	}

	h4 {
		margin: 0;
		font-size: var(--font-size-label);
		font-weight: var(--weight-strong);
		color: var(--text);
	}

	.choice {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
	}

	.version {
		color: var(--readable-muted);
		font-size: var(--font-size-label);
		margin-left: var(--space-1);
	}

	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.hint {
		margin: 0;
		color: var(--readable-muted);
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
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
