<script lang="ts">
	import type { FieldState } from './limitsForm';

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
		<span class="sr-only">{legend} own value</span>
		<input
			type="text"
			inputmode="numeric"
			pattern="[0-9]*"
			aria-label={`${legend} value`}
			disabled={state.mode !== 'value'}
			bind:value={state.value}
		/>
	</label>
	<label><input type="radio" {name} value="unlimited" bind:group={state.mode} /> Unlimited</label>
</fieldset>

<style>
	.field {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		margin-block: 0.5rem;
		border: 1px solid var(--border, currentColor);
		border-radius: 0.5rem;
	}
	.own {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
	}
	.own input[type='text'] {
		width: 6rem;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
