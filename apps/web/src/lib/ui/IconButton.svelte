<script lang="ts">
	// An icon-only button (design §5): always named (`label`, required) and
	// always with a tooltip showing that name on hover and keyboard focus.
	// No box at rest; a --raised wash on hover; the focus ring on keyboard
	// focus; at least a 44px target on coarse pointers.
	//
	// API: <IconButton label icon size? pressed? href? disabled? tooltip? placement? onclick? …rest />
	//   label      the accessible name and the tooltip (t(…))
	//   icon       an IconName
	//   size       the icon size: 's' | 'm' (default) | 'l'
	//   pressed    a toggle: sets aria-pressed (the pressed look is the accent)
	//   href       renders a link instead of a button
	//   tooltip    false only where the same words are visible next to it
	//   placement  where the tooltip opens (Tooltip)
	//   tooltipSuppressed  hides the tooltip for now (its menu is open)
	//   class      extra classes (kept with the component's own)
	//   …rest      passed to the <button>/<a> (aria-haspopup, aria-expanded, …);
	//              the component's own name and pressed state win over it
	import type { HTMLAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import Tooltip from './Tooltip.svelte';
	import type { IconName } from './icons/lucide';

	type Props = {
		label: string;
		icon: IconName;
		size?: 's' | 'm' | 'l';
		pressed?: boolean;
		href?: string;
		disabled?: boolean;
		tooltip?: boolean;
		placement?: 'below' | 'above' | 'start' | 'end' | 'below-end';
		tooltipSuppressed?: boolean;
		onclick?: (e: MouseEvent) => void;
		element?: HTMLElement;
		class?: string;
	} & Omit<HTMLAttributes<HTMLElement>, 'onclick' | 'class'>;

	let {
		label,
		icon,
		size = 'm',
		pressed,
		href,
		disabled = false,
		tooltip = true,
		placement = 'below',
		tooltipSuppressed = false,
		onclick,
		element = $bindable(),
		class: className = '',
		...rest
	}: Props = $props();

	// An unnamed icon-only control is an accessibility bug: fail loudly in
	// development and tests (a blank translation, a forgotten prop).
	$effect.pre(() => {
		if (import.meta.env.DEV && !label?.trim()) throw new Error('IconButton: `label` must not be empty');
	});
</script>

{#snippet control()}
	{#if href}
		<a {...rest} bind:this={element} class="icon-button {className}" {href} aria-label={label} {onclick}><Icon name={icon} {size} /></a>
	{:else}
		<button
			{...rest}
			bind:this={element}
			type="button"
			class="icon-button {className}"
			aria-label={label}
			aria-pressed={pressed === undefined ? rest['aria-pressed'] : pressed}
			{disabled}
			{onclick}><Icon name={icon} {size} /></button
		>
	{/if}
{/snippet}

{#if tooltip}
	<Tooltip text={label} {placement} suppress={tooltipSuppressed}>
		{#snippet children()}{@render control()}{/snippet}
	</Tooltip>
{:else}
	{@render control()}
{/if}

<style>
	.icon-button {
		display: inline-grid;
		place-items: center;
		box-sizing: border-box;
		min-width: 2.25rem;
		min-height: 2.25rem;
		padding: var(--space-2);
		border: 1px solid transparent;
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		font: inherit;
		text-decoration: none;
		cursor: pointer;
		transition: background-color var(--motion-fast) var(--ease-standard);
	}
	.icon-button:hover {
		background: var(--raised);
	}
	.icon-button:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.icon-button[aria-pressed='true'] {
		color: var(--accent);
		background: var(--selected-wash);
	}
	.icon-button:disabled {
		color: var(--readable-muted);
		cursor: not-allowed;
		background: transparent;
	}
	@media (pointer: coarse) {
		.icon-button {
			min-width: var(--hit);
			min-height: var(--hit);
		}
	}
	@media (forced-colors: active) {
		.icon-button:hover,
		.icon-button[aria-pressed='true'] {
			border-color: ButtonText;
		}
		.icon-button[aria-pressed='true'] {
			outline: 2px solid Highlight;
		}
		.icon-button:disabled {
			color: GrayText;
		}
		.icon-button:focus-visible {
			outline-color: Highlight;
		}
	}
</style>
