<script lang="ts">
	// A select (design §5: fields are an underline, not a box). The native
	// control and its arrow are kept; only the underline, label and helper
	// text follow the base components. The Field API, so a page swaps one
	// for the other.
	//
	// API: <Select label bind:value? options hint? error? hideLabel? id? …rest />
	//   label      the field's name (t(…)); always present
	//   value      bindable string
	//   options    { value, label }[] (rendered first)
	//   groups     { label, options }[] (rendered after `options`, as optgroups)
	//   hint       help text under the field
	//   error      error text; sets aria-invalid
	//   hideLabel  keeps the label for assistive tech only
	//   …rest      passed to the <select> (disabled, required, …);
	//              the component's own id, invalid state and descriptions win
	import type { HTMLSelectAttributes } from 'svelte/elements';

	interface Option {
		value: string;
		label: string;
	}

	type Props = {
		label: string;
		value?: string;
		options?: readonly Option[];
		groups?: readonly { label: string; options: readonly Option[] }[];
		hint?: string;
		error?: string;
		hideLabel?: boolean;
		id?: string;
		element?: HTMLSelectElement;
	} & Omit<HTMLSelectAttributes, 'value' | 'id'>;

	const uid = $props.id();
	let {
		label,
		value = $bindable(''),
		options = [],
		groups = [],
		hint,
		error,
		hideLabel = false,
		id = `${uid}-select`,
		element = $bindable(),
		...rest
	}: Props = $props();

	$effect.pre(() => {
		if (import.meta.env.DEV && !label?.trim()) throw new Error('Select: `label` must not be empty');
	});

	const hintId = $derived(`${id}-hint`);
	const errorId = $derived(`${id}-error`);
	const describedby = $derived(
		[hint ? hintId : '', error ? errorId : '', rest['aria-describedby'] ?? ''].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field" class:invalid={!!error}>
	<label for={id} class={hideLabel ? 'visually-hidden' : 'label'}>{label}</label>
	<select
		{...rest}
		bind:this={element}
		{id}
		bind:value
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedby}
	>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
		{#each groups as group (group.label)}
			<optgroup label={group.label}>
				{#each group.options as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</optgroup>
		{/each}
	</select>
	{#if hint}<p class="hint" id={hintId}>{hint}</p>{/if}
	{#if error}<p class="error" id={errorId} role="alert">{error}</p>{/if}
</div>

<style>
	.field {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}
	.label {
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	select {
		box-sizing: border-box;
		width: 100%;
		min-height: 2.25rem;
		padding: var(--space-1) 0;
		border: 0;
		border-bottom: 1px solid var(--line);
		border-radius: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		line-height: var(--line-body);
		transition: box-shadow var(--motion-fast) var(--ease-standard);
	}
	/* The native arrow stays (no custom popup): the control is a select. */
	select:focus {
		outline: none;
		border-bottom-color: var(--accent);
		box-shadow: 0 1px 0 0 var(--accent);
	}
	.invalid select {
		border-bottom-color: var(--bad);
	}
	.hint,
	.error {
		margin: 0;
		font-size: var(--font-size-label);
	}
	.hint {
		color: var(--readable-muted);
	}
	.error {
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
	}
	@media (prefers-reduced-motion: reduce) {
		select {
			transition: none;
		}
	}
	@media (forced-colors: active) {
		select {
			color: CanvasText;
			border-bottom-color: CanvasText;
		}
		select:focus {
			outline: 2px solid Highlight;
			outline-offset: 2px;
			box-shadow: none;
		}
	}
</style>
