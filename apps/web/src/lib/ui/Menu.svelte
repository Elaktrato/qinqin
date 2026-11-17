<script lang="ts">
	// A menu button and its popup (APG menu button pattern; design §5: menus
	// are a floating layer that fades in). The trigger is an icon button with
	// a tooltip (`icon`) or a text button (`text`); the popup holds MenuItems.
	// Opening focuses the checked item, else the first; Up/Down wrap,
	// Home/End jump, a letter jumps to the next item starting with it; Escape
	// closes and returns focus to the trigger; Tab and a pointer outside close
	// without taking focus.
	//
	// API: <Menu label icon?|text? menuLabel? align? bind:open? triggerClass?>…MenuItems…</Menu>
	//   label      the trigger's accessible name (icon trigger) and the menu's
	//              name unless menuLabel is given (t(…))
	//   icon       an IconName: an icon-only trigger with a tooltip
	//   text       visible trigger text (its name; label is then unused)
	//   menuLabel  the popup's accessible name, when it differs from label
	//   align      'end' (default: the popup's end edge under the trigger's) | 'start'
	//   open       bindable (the gallery renders it open)
	import { tick, type Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import IconButton from './IconButton.svelte';
	import type { IconName } from './icons/lucide';
	import { setMenuContext } from './menu';

	let {
		label,
		icon,
		text,
		menuLabel,
		align = 'end',
		open = $bindable(false),
		triggerClass = '',
		children
	}: {
		label: string;
		icon?: IconName;
		text?: string;
		menuLabel?: string;
		align?: 'start' | 'end';
		open?: boolean;
		triggerClass?: string;
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

	setMenuContext({ close });

	async function toggle(): Promise<void> {
		open = !open;
		if (!open) return;
		await tick();
		const list = items();
		(list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
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
			e.preventDefault();
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
	{#if icon && !text}
		<IconButton
			bind:element={trigger}
			{label}
			{icon}
			class={triggerClass}
			aria-haspopup="menu"
			aria-expanded={open}
			aria-controls={open ? menuId : undefined}
			tooltipSuppressed={open}
			onclick={toggle}
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
			>{#if icon}<Icon name={icon} size="s" />{/if}{text ?? label}<Icon name="expand-down" size="s" /></button
		>
	{/if}
	{#if open}
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="menu {align}"
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
	.text-trigger:hover {
		background: var(--raised);
	}
	.text-trigger:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.menu {
		position: absolute;
		top: calc(100% + var(--space-1));
		z-index: var(--layer-float);
		box-sizing: border-box;
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
		.text-trigger:focus-visible {
			outline-color: Highlight;
		}
	}
</style>
