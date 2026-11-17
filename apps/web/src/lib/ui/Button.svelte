<script lang="ts">
	// A text button (design §5): one primary action per view in the soft accent
	// tint (--primary-wash behind --text); secondary actions a hairline outline or plain text; a filled accent
	// only where a fill is the needed cue (rare).
	//
	// API: <Button variant? tone? type? href? disabled? busy? icon? onclick? …rest>text</Button>
	//   variant  'secondary' (default) | 'primary' | 'plain' | 'filled'
	//   tone     'default' | 'danger' (destructive: --readable-bad text, --bad line)
	//   type     'button' (default) | 'submit' | 'reset'
	//   form     the id of the form a submit button belongs to (a Dialog action outside its form)
	//   href     renders a link styled as the button
	//   busy     aria-busy + disabled while an action runs
	//   icon     a decorative IconName before the text
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons/lucide';

	type Props = {
		variant?: 'primary' | 'secondary' | 'plain' | 'filled';
		tone?: 'default' | 'danger';
		type?: 'button' | 'submit' | 'reset';
		form?: string;
		href?: string;
		disabled?: boolean;
		busy?: boolean;
		icon?: IconName;
		onclick?: (e: MouseEvent) => void;
		element?: HTMLElement;
		children: Snippet;
	} & Omit<HTMLAttributes<HTMLElement>, 'onclick' | 'children'>;

	let {
		variant = 'secondary',
		tone = 'default',
		type = 'button',
		form,
		href,
		disabled = false,
		busy = false,
		icon,
		onclick,
		element = $bindable(),
		children,
		...rest
	}: Props = $props();

	const classes = $derived(`button ${variant}${tone === 'danger' ? ' danger' : ''}`);
</script>

{#if href}
	<a bind:this={element} class={classes} {href} {onclick} {...rest}
		>{#if icon}<Icon name={icon} size="s" />{/if}{@render children()}</a
	>
{:else}
	<button
		bind:this={element}
		class={classes}
		{type}
		{form}
		disabled={disabled || busy}
		aria-busy={busy ? 'true' : undefined}
		{onclick}
		{...rest}>{#if icon}<Icon name={icon} size="s" />{/if}{@render children()}</button
	>
{/if}

<style>
	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		box-sizing: border-box;
		min-height: 2.25rem;
		padding: var(--space-2) var(--space-4);
		border: 1px solid transparent;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-weight: var(--weight-medium);
		line-height: var(--line-tight);
		text-decoration: none;
		cursor: pointer;
		transition:
			background-color var(--motion-fast) var(--ease-standard),
			border-color var(--motion-fast) var(--ease-standard);
	}
	.button:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	/* Hover never changes the text colour or the fill (a tint or --raised
	   under coloured text drops below 4.5:1 in some themes): an underline,
	   and a stronger outline for secondary. Button.contrast.test.ts. */
	.button:hover:not(:disabled) {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.primary {
		background: var(--primary-wash);
		color: var(--text);
		font-weight: var(--weight-strong);
	}
	.secondary {
		border-color: var(--hair);
	}
	.secondary:hover:not(:disabled) {
		border-color: var(--line);
	}
	.plain {
		padding-inline: var(--space-2);
	}
	.filled {
		background: var(--accent);
		color: var(--on-accent);
		font-weight: var(--weight-strong);
	}
	.danger {
		color: var(--readable-bad);
	}
	.secondary.danger {
		border-color: var(--bad);
	}
	.button:disabled {
		background: transparent;
		border-color: var(--hair);
		color: var(--readable-muted);
		cursor: not-allowed;
	}
	.plain:disabled {
		border-color: transparent;
	}
	.button[aria-busy='true'] {
		cursor: progress;
	}
	@media (pointer: coarse) {
		.button {
			min-height: var(--hit);
		}
	}
	@media (forced-colors: active) {
		.button {
			border-color: ButtonText;
		}
		.plain {
			border-color: transparent;
			text-decoration: underline;
		}
		.button:disabled {
			border-color: GrayText;
			color: GrayText;
		}
		.button:focus-visible {
			outline-color: Highlight;
		}
	}
</style>
