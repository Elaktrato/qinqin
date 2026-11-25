<script lang="ts">
	// A menu button and its popup (APG menu button pattern; design §5: menus
	// are a floating layer that fades in). The trigger is an icon button with
	// a tooltip (`icon`), a text button (`text`) or custom content with a
// tooltip (`trigger`: the frame's flag and avatar); the popup holds MenuItems.
	// Opening focuses the checked item, else the first; ArrowDown/ArrowUp
	// on the trigger open it on the first/last item; Up/Down wrap,
	// Home/End jump, a letter jumps to the next item starting with it; Escape
	// closes and returns focus to the trigger; Tab and a pointer outside close
	// without taking focus.
	//
	// API: <Menu label icon?|text?|trigger? menuLabel? align? direction? bind:open? triggerClass?>…MenuItems…</Menu>
	//   label      the trigger's accessible name (icon trigger) and the menu's
	//              name unless menuLabel is given (t(…))
	//   icon       an IconName: an icon-only trigger with a tooltip
	//   text       visible trigger text (its name; label is then unused)
	//   trigger    a snippet drawn inside the trigger button (decorative: the
	//              button is named by label and shows it as a tooltip)
	//   menuLabel  the popup's accessible name, when it differs from label
	//   align      'end' (default: the popup's end edge under the trigger's) | 'start'
	//   tooltipPlacement  where the trigger's tooltip opens (Tooltip; default below)
	//   direction  'down' (default) | 'up' (the popup opens above the trigger)
	//   open       bindable (the gallery renders it open)
	//   A MenuItem with keepOpen leaves the menu open after its pick (a level
	//   inside the same popup): focus then goes to the item marked `focus`,
	//   else the first item of the new content.
	import { tick, type Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import IconButton from './IconButton.svelte';
	import Tooltip from './Tooltip.svelte';
	import type { IconName } from './icons/lucide';
	import { registerDismissable } from './dismissStack';
	import { setMenuContext } from './menu';

	let {
		label,
		icon,
		text,
		menuLabel,
		align = 'end',
		direction = 'down',
		tooltipPlacement = 'below',
		open = $bindable(false),
		triggerClass = '',
		trigger: triggerContent,
		children
	}: {
		label: string;
		icon?: IconName;
		text?: string;
		menuLabel?: string;
		align?: 'start' | 'end';
		direction?: 'down' | 'up';
		tooltipPlacement?: 'below' | 'above' | 'start' | 'end' | 'below-end';
		open?: boolean;
		triggerClass?: string;
		trigger?: Snippet;
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const menuId = `${uid}-menu`;
	let trigger = $state<HTMLElement>();
	let menu = $state<HTMLElement>();
	let wrapper = $state<HTMLElement>();

	function items(): HTMLElement[] {
		return menu
			? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')]
			: [];
	}

	function close(returnFocus: boolean): void {
		open = false;
		if (returnFocus) trigger?.focus();
	}

	// After a keepOpen pick the popup's content may change: focus the item
	// marked to take it, else the first one.
	async function settle(): Promise<void> {
		await tick();
		const list = items();
		(list.find((el) => el.hasAttribute('data-menu-focus')) ?? list[0])?.focus();
	}

	setMenuContext({ close, settle });

	// An open menu is the innermost thing to close for the Android back button (dismissStack.ts).
	$effect(() => {
		if (!open) return;
		return registerDismissable(() => close(true));
	});

	// Opens and focuses the checked item (else the first), or the first or
	// last item (ArrowDown / ArrowUp on the trigger, APG menu button).
	async function show(at: 'checked' | 'first' | 'last'): Promise<void> {
		open = true;
		await tick();
		const list = items();
		const pick =
			at === 'last'
				? list[list.length - 1]
				: at === 'first'
					? list[0]
					: (list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0]);
		pick?.focus();
	}

	function toggle(): void {
		if (open) open = false;
		else void show('checked');
	}

	function triggerKeys(e: KeyboardEvent): void {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		void show(e.key === 'ArrowDown' ? 'first' : 'last');
	}

	function onkeydown(e: KeyboardEvent): void {
		const list = items();
		if (list.length === 0) return;
		const at = list.indexOf(document.activeElement as HTMLElement);
		let next = -1;
		if (e.key === 'ArrowDown') next = (at + 1) % list.length;
		else if (e.key === 'ArrowUp') next = (at - 1 + list.length) % list.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = list.length - 1;
		else if (e.key === 'Escape') {
			// Closes this menu only: an enclosing drawer or dialog stays open (the key
			// ends here; a Dialog around the menu closes on the next Escape).
			e.preventDefault();
			e.stopPropagation();
			close(true);
			return;
		} else if (e.key === 'Tab') {
			close(false);
			return;
		} else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.trim() !== '') {
			const key = e.key.toLocaleLowerCase();
			for (let step = 1; step <= list.length; step++) {
				const i = (at + step) % list.length;
				if ((list[i].textContent ?? '').trim().toLocaleLowerCase().startsWith(key)) {
					next = i;
					break;
				}
			}
		}
		if (next >= 0) {
			e.preventDefault();
			list[next].focus();
		}
	}

	function outside(e: PointerEvent): void {
		if (open && wrapper && !wrapper.contains(e.target as Node)) close(false);
	}
</script>

<svelte:document onpointerdown={outside} />

<div class="menu-wrap" bind:this={wrapper}>
	{#if triggerContent}
		<Tooltip text={label} suppress={open} placement={tooltipPlacement}>
			{#snippet children()}
				<button
					bind:this={trigger}
					type="button"
					class="custom-trigger {triggerClass}"
					aria-label={label}
					aria-haspopup="menu"
					aria-expanded={open}
					aria-controls={open ? menuId : undefined}
					onclick={toggle}
					onkeydown={triggerKeys}>{@render triggerContent()}</button
				>
			{/snippet}
		</Tooltip>
	{:else if icon && !text}
		<IconButton
			bind:element={trigger}
			{label}
			{icon}
			class={triggerClass}
			aria-haspopup="menu"
			aria-expanded={open}
			aria-controls={open ? menuId : undefined}
			tooltipSuppressed={open}
			placement={tooltipPlacement}
			onclick={toggle}
			onkeydown={triggerKeys}
		/>
	{:else}
		<button
			bind:this={trigger}
			type="button"
			class="text-trigger {triggerClass}"
			aria-haspopup="menu"
			aria-expanded={open}
			aria-controls={open ? menuId : undefined}
			onclick={toggle}
			onkeydown={triggerKeys}
			>{#if icon}<Icon name={icon} size="s" />{/if}{text ?? label}<Icon name="expand-down" size="s" /></button
		>
	{/if}
	{#if open}
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="menu {align} {direction}"
			id={menuId}
			role="menu"
			aria-label={menuLabel ?? label}
			bind:this={menu}
			{onkeydown}
		>
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.menu-wrap {
		position: relative;
		display: inline-flex;
	}
	.text-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 2.25rem;
		padding: var(--space-1) var(--space-2);
		border: 1px solid transparent;
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.custom-trigger {
		display: inline-grid;
		place-items: center;
		box-sizing: border-box;
		min-width: 2.25rem;
		min-height: 2.25rem;
		padding: var(--space-1);
		border: 1px solid transparent;
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.text-trigger:hover,
	.custom-trigger:hover {
		background: var(--raised);
	}
	.text-trigger:focus-visible,
	.custom-trigger:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.menu {
		position: absolute;
		top: calc(100% + var(--space-1));
		z-index: var(--layer-float);
		box-sizing: border-box;
		/* Its own width, not the trigger's (the containing block). */
		width: max-content;
		min-width: 12rem;
		max-width: min(20rem, calc(100vw - 2 * var(--space-4)));
		max-height: 70vh;
		overflow-y: auto;
		display: grid;
		padding: var(--space-1);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-float);
		animation: menu-in var(--motion-fast) var(--ease-standard);
	}
	.up {
		top: auto;
		bottom: calc(100% + var(--space-1));
	}
	.end {
		inset-inline-end: 0;
	}
	.start {
		inset-inline-start: 0;
	}
	@keyframes menu-in {
		from {
			opacity: 0;
			translate: 0 -2px;
		}
	}
	@media (forced-colors: active) {
		.menu {
			border-color: CanvasText;
		}
		.text-trigger:focus-visible,
		.custom-trigger:focus-visible {
			outline-color: Highlight;
		}
	}
	@media (pointer: coarse) {
		.custom-trigger {
			min-width: var(--hit);
			min-height: var(--hit);
		}
	}
</style>
