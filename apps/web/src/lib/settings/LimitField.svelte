<script lang="ts">
	import { t } from '$lib/i18n';
	import type { FieldState } from './limitsForm';
	import Field from '$lib/ui/Field.svelte';

	// One limit field: "use workspace" (decks only), an own number, or unlimited.
	let {
		legend,
		name,
		state = $bindable(),
		workspaceLabel = null
	}: {
		legend: string;
		name: string;
		state: FieldState;
		/** The label of the "follow the workspace" choice; null where it does not apply. */
		workspaceLabel?: string | null;
	} = $props();
</script>

<fieldset class="field">
	<legend>{legend}</legend>
	{#if workspaceLabel !== null}
		<label><input type="radio" {name} value="workspace" bind:group={state.mode} /> {workspaceLabel}</label>
	{/if}
	<label class="own">
		<input type="radio" {name} value="value" bind:group={state.mode} />
		<span class="sr-only">{t('settings.limitField.own', { legend })}</span>
	</label>
	<div class="value">
		<Field
			label={t('settings.limitField.value', { legend })}
			hideLabel
			type="number"
			min="0"
			max="9999"
			step="1"
			disabled={state.mode !== 'value'}
			value={state.value}
			oninput={(event) => (state.value = event.currentTarget.value)}
		/>
	</div>
	<label><input type="radio" {name} value="unlimited" bind:group={state.mode} /> {t('settings.limitField.unlimited')}</label>
</fieldset>

<style>
	.field {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		align-items: center;
		margin-block: var(--space-2);
	}

	.own {
		display: inline-flex;
		gap: var(--space-1);
		align-items: center;
	}

	.value {
		width: 6rem;
	}
</style>
