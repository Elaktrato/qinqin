<script lang="ts">
	// A text field (design §5): an underline, not a box. The label sits above
	// in the small muted label style (or is visually hidden, for a search
	// field whose purpose the page already shows); the hint and the error are
	// linked with aria-describedby; an error also has a --bad bar (a cue that
	// does not depend on the text colour).
	//
	// API: <Field label bind:value? type? hint? error? hideLabel? multiline? id? element? …rest />
	//   label      the field's name (t(…)); always present
	//   value      bindable string
	//   type       input type (default 'text'); ignored when multiline
	//   hint       help text under the field
	//   error      error text; sets aria-invalid
	//   hideLabel  keeps the label for assistive tech only
	//   multiline  a <textarea>
	//   …rest      passed to the input (placeholder, autocomplete, required, …);
	//              the component's own id, invalid state and descriptions win
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = {
		label: string;
		value?: string;
		type?: string;
		hint?: string;
		error?: string;
		hideLabel?: boolean;
		multiline?: boolean;
		id?: string;
		element?: HTMLInputElement | HTMLTextAreaElement;
	} & Omit<HTMLInputAttributes, 'value' | 'type' | 'id'>;

	const uid = $props.id();
	let {
		label,
		value = $bindable(''),
		type = 'text',
		hint,
		error,
		hideLabel = false,
		multiline = false,
		id = `${uid}-input`,
		element = $bindable(),
		...rest
	}: Props = $props();

	$effect.pre(() => {
		if (import.meta.env.DEV && !label?.trim()) throw new Error('Field: `label` must not be empty');
	});

	const hintId = $derived(`${id}-hint`);
	const errorId = $derived(`${id}-error`);
	// The hint and error, then any description the caller passes.
	const describedby = $derived(
		[hint ? hintId : '', error ? errorId : '', rest['aria-describedby'] ?? ''].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field" class:invalid={!!error}>
	<label for={id} class={hideLabel ? 'visually-hidden' : 'label'}>{label}</label>
	{#if multiline}
		<textarea
			{...rest as Record<string, unknown>}
			bind:this={element}
			{id}
			bind:value
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedby}
		></textarea>
	{:else}
		<input
			{...rest}
			bind:this={element}
			{id}
			{type}
			bind:value
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedby}
		/>
	{/if}
	{#if hint}<p class="hint" id={hintId}>{hint}</p>{/if}
	{#if error}<p class="error" id={errorId}>{error}</p>{/if}
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
	input,
	textarea {
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
	textarea {
		min-height: 5rem;
		resize: vertical;
	}
	input::placeholder,
	textarea::placeholder {
		color: var(--readable-muted);
	}
	/* Focus: the underline becomes a 2px accent line (the field's focus cue). */
	input:focus,
	textarea:focus {
		outline: none;
		border-bottom-color: var(--accent);
		box-shadow: 0 1px 0 0 var(--accent);
	}
	.invalid input,
	.invalid textarea {
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
	@media (forced-colors: active) {
		input:focus,
		textarea:focus {
			outline: 2px solid Highlight;
			outline-offset: 2px;
		}
	}
</style>
