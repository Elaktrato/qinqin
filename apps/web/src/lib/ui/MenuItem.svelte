<script lang="ts">
	// One entry of a Menu: an action (menuitem), a choice (menuitemradio with
	// aria-checked; a check mark is the non-colour cue), a link (menuitem with
	// href), or a separator. Picking one closes the menu: an action or choice
	// returns focus to the trigger, a link lets the navigation move it.
	// A keepOpen item leaves the menu open (it changes the menu's content,
	// e.g. a drill-in level); focus then moves to the item marked `focus`.
	//
	// API: <MenuItem onselect? href? checked? icon? keepOpen? focus? label? tone? separator?>text</MenuItem>
	//   onselect   runs after the menu closes
	//   href       a link item
	//   checked    makes it a radio item (true/false); leave out for an action
	//   icon       a decorative IconName before the text
	//   keepOpen   the pick keeps the menu open (onselect runs, focus settles)
	//   focus      this item takes focus when the content settles after a keepOpen pick
	//   tone       'bad': the words in the readable bad colour (Sign out; the
	//              icon and the words carry the meaning, not the colour)
	//   label      an accessible name when the visible text is laid out in parts
	//              (it must contain the visible words, WCAG 2.5.3)
	//   separator  a hairline between groups (no text)
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons/lucide';
	import { getMenuContext } from './menu';

	let {
		onselect,
		href,
		checked,
		icon,
		keepOpen = false,
		focus = false,
		label,
		tone,
		separator = false,
		children
	}: {
		onselect?: () => void;
		href?: string;
		checked?: boolean;
		icon?: IconName;
		keepOpen?: boolean;
		focus?: boolean;
		label?: string;
		tone?: 'bad';
		separator?: boolean;
		children?: Snippet;
	} = $props();

	const menu = getMenuContext();

	function select(): void {
		if (keepOpen) {
			onselect?.();
			menu?.settle();
			return;
		}
		menu?.close(!href);
		onselect?.();
	}
</script>

{#if separator}
	<div class="separator" role="separator"></div>
{:else if href}
	<a class="item {tone ?? ''}" role="menuitem" tabindex="-1" {href} aria-label={label} data-menu-focus={focus || undefined} onclick={select}
		>{#if icon}<Icon name={icon} size="s" />{/if}<span class="text">{@render children?.()}</span></a
	>
{:else}
	<button
		type="button"
		class="item {tone ?? ''}"
		role={checked === undefined ? 'menuitem' : 'menuitemradio'}
		aria-checked={checked === undefined ? undefined : checked}
		tabindex="-1"
		aria-label={label}
		data-menu-focus={focus || undefined}
		onclick={select}
		>{#if checked !== undefined}<span class="check" aria-hidden="true">{#if checked}<Icon name="check" size="s" />{/if}</span
			>{/if}{#if icon}<Icon name={icon} size="s" />{/if}<span class="text">{@render children?.()}</span></button
	>
{/if}

<style>
	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.25rem;
		box-sizing: border-box;
		padding: var(--space-2) var(--space-3);
		border: 0;
		border-radius: calc(var(--radius) * 0.75);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: start;
		text-decoration: none;
		cursor: pointer;
	}
	.bad {
		color: var(--readable-bad);
	}
	.item:hover {
		background: var(--raised);
	}
	.item:focus-visible {
		outline: var(--focus-ring);
		outline-offset: calc(-1 * var(--focus-ring-offset));
	}
	.item[aria-checked='true'] {
		background: var(--selected-wash);
		font-weight: var(--weight-strong);
	}
	.check {
		display: inline-grid;
		place-items: center;
		width: var(--icon-s);
		height: var(--icon-s);
		color: var(--accent);
	}
	.text {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.separator {
		height: 1px;
		margin: var(--space-1) 0;
		background: var(--hair);
	}
	@media (pointer: coarse) {
		.item {
			min-height: var(--hit);
		}
	}
	@media (forced-colors: active) {
		.item:focus-visible {
			outline-color: Highlight;
		}
		.check {
			color: CanvasText;
		}
		.separator {
			background: CanvasText;
		}
	}
</style>
