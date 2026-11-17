<script lang="ts">
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import type { Workspace } from '$lib/api/types';
	import { workspaceDisplay } from '$lib/languages';
	import { listboxKey } from '$lib/listbox';
	import { select as selectWorkspace, workspaces } from '$lib/workspaces';
	import WorkspaceCreateForm from './WorkspaceCreateForm.svelte';
	import WorkspaceLabel from './WorkspaceLabel.svelte';

	// Header workspace switcher: a button that opens a single-select
	// listbox (flags need real markup, which a native <select> cannot
	// render) plus a "New workspace" inline form below the options.
	// Keyboard: arrows/Home/End move, Enter/Space choose, Escape closes
	// and returns focus to the button; focus leaving the picker or a
	// click outside closes it.

	const listId = 'workspace-picker-list';

	let open = $state(false);
	let creating = $state(false);
	let active = $state(-1);
	let root = $state<HTMLDivElement | null>(null);
	let button = $state<HTMLButtonElement | null>(null);
	let listbox = $state<HTMLUListElement | null>(null);
	let panel = $state<HTMLDivElement | null>(null);

	const list = $derived($workspaces.list);
	const current = $derived($workspaces.current);
	const currentDisplay = $derived(current ? workspaceDisplay(list, current) : null);
	const buttonLabel = $derived(
		currentDisplay
			? currentDisplay.showName && currentDisplay.name !== currentDisplay.label
				? t('app.workspaces.picker.currentNamed', { label: currentDisplay.label, name: currentDisplay.name })
				: t('app.workspaces.picker.current', { label: currentDisplay.label })
			: t('app.workspaces.picker.none')
	);

	function optionId(workspace: Workspace): string {
		return `workspace-option-${workspace.id}`;
	}

	async function openMenu(focusIndex?: number): Promise<void> {
		open = true;
		creating = list.length === 0;
		const selected = list.findIndex((workspace) => workspace.id === current?.id);
		active = focusIndex ?? (selected >= 0 ? selected : list.length > 0 ? 0 : -1);
		await tick();
		placePanel();
		if (list.length > 0) listbox?.focus();
	}

	// The panel hangs from the trigger's right edge; on narrow screens,
	// where the header wraps and the trigger sits further left, shift it
	// right so it never leaves the viewport.
	function placePanel(): void {
		if (!panel) return;
		panel.style.right = '';
		const margin = 8;
		const rect = panel.getBoundingClientRect();
		if (rect.left < margin) panel.style.right = `${rect.left - margin}px`;
	}

	function closeMenu(returnFocus: boolean): void {
		open = false;
		creating = false;
		if (returnFocus) button?.focus();
	}

	function toggle(): void {
		if (open) closeMenu(false);
		else void openMenu();
	}

	function choose(index: number): void {
		const workspace = list[index];
		if (workspace) selectWorkspace(workspace.id);
		closeMenu(true);
	}

	function buttonKeydown(event: KeyboardEvent): void {
		if (open) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const selected = list.findIndex((workspace) => workspace.id === current?.id);
			const start = selected >= 0 ? selected : event.key === 'ArrowDown' ? 0 : list.length - 1;
			void openMenu(list.length > 0 ? start : -1);
		}
	}

	function listKeydown(event: KeyboardEvent): void {
		// Tab moves on to "New workspace" inside the picker; leaving the
		// picker altogether closes it through the focusout handler.
		if (event.key === 'Tab') return;
		const result = listboxKey(event.key, active, list.length);
		if (result.action === 'none') return;
		event.preventDefault();
		if (result.action === 'move') {
			active = result.index;
			document.getElementById(optionId(list[active]))?.scrollIntoView({ block: 'nearest' });
		} else if (result.action === 'select') {
			choose(result.index);
		} else {
			closeMenu(true);
		}
	}

	function panelKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			closeMenu(true);
		}
	}

	function focusout(event: FocusEvent): void {
		const next = event.relatedTarget;
		if (open && next instanceof Node && root && !root.contains(next)) closeMenu(false);
	}

	function windowPointerdown(event: PointerEvent): void {
		if (!open || !root) return;
		if (event.target instanceof Node && root.contains(event.target)) return;
		closeMenu(false);
	}

	// Escape still closes the picker when focus has fallen back to
	// <body> (for example after an element inside the panel vanished).
	function windowKeydown(event: KeyboardEvent): void {
		if (open && event.key === 'Escape' && document.activeElement === document.body) {
			event.preventDefault();
			closeMenu(true);
		}
	}

	function startCreate(): void {
		creating = true;
	}

	function created(): void {
		closeMenu(true);
	}

	function cancelCreate(): void {
		if (list.length === 0) {
			closeMenu(true);
			return;
		}
		creating = false;
		void tick().then(() => listbox?.focus());
	}
</script>

<svelte:window onpointerdown={windowPointerdown} onkeydown={windowKeydown} />

<div class="picker" bind:this={root} onfocusout={focusout}>
	<button
		type="button"
		class="trigger"
		bind:this={button}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={open ? listId : undefined}
		aria-label={buttonLabel}
		title={buttonLabel}
		onclick={toggle}
		onkeydown={buttonKeydown}
	>
		{#if current}
			<WorkspaceLabel workspace={current} {list} size={14} />
		{:else}
			<span class="none">{t('app.workspaces.picker.noWorkspace')}</span>
		{/if}
		<svg class="caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
			<path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" />
		</svg>
	</button>

	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="panel" bind:this={panel} onkeydown={panelKeydown}>
			{#if list.length > 0}
				<ul
					id={listId}
					class="options"
					role="listbox"
					aria-label={t('app.workspaces.picker.list')}
					tabindex="-1"
					bind:this={listbox}
					aria-activedescendant={active >= 0 && list[active] ? optionId(list[active]) : undefined}
					onkeydown={listKeydown}
				>
					{#each list as workspace, index (workspace.id)}
						<!-- Pointer selection on an option; keyboard selection is handled by the listbox. -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<li
							id={optionId(workspace)}
							role="option"
							aria-selected={workspace.id === current?.id}
							class:active={index === active}
							onclick={() => choose(index)}
							onpointermove={() => (active = index)}
						>
							<WorkspaceLabel {workspace} {list} withLanguage />
							{#if workspace.id === current?.id}
								<svg class="check" viewBox="0 0 12 10" width="12" height="10" aria-hidden="true">
									<path d="M1 5l3.5 3.5L11 1" fill="none" stroke="currentColor" stroke-width="1.8" />
								</svg>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if creating}
				<div class="create">
					<WorkspaceCreateForm
						idPrefix="picker-new"
						autofocus
						onCreated={created}
						onCancel={cancelCreate}
					/>
				</div>
			{:else}
				<button type="button" class="new" onclick={startCreate}>{t('app.workspaces.picker.new')}</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
	}

	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		max-width: 14rem;
		font: inherit;
		font-size: 0.9rem;
		padding: 0.3rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.trigger:focus-visible,
	.options:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.none {
		color: var(--readable-muted);
	}

	.caret {
		flex: none;
		color: var(--readable-muted);
	}

	.panel {
		position: absolute;
		top: calc(100% + 0.35rem);
		right: 0;
		z-index: 20;
		/* A fixed width keeps placePanel's measurement valid when the
		   create form replaces the "New workspace" button. */
		width: min(19rem, calc(100vw - 1rem));
		box-sizing: border-box;
		padding: 0.35rem;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 0.5rem;
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-float);
	}

	.options {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: min(18rem, 60vh);
		overflow-y: auto;
	}

	.options li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.4rem 0.5rem;
		border-radius: 0.35rem;
		cursor: pointer;
	}

	.options li.active {
		background: color-mix(in srgb, var(--accent) 16%, transparent);
	}

	.options li[aria-selected='true'] {
		font-weight: 600;
	}

	.check {
		flex: none;
		color: var(--reading-accent);
	}

	.new {
		display: block;
		width: 100%;
		margin-top: 0.25rem;
		padding: 0.4rem 0.5rem;
		border: 0;
		border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
		border-radius: 0 0 0.35rem 0.35rem;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.new:hover,
	.new:focus-visible {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.create {
		padding: 0.5rem 0.35rem 0.25rem;
		border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
	}

	.options + .create {
		margin-top: 0.25rem;
	}
</style>
