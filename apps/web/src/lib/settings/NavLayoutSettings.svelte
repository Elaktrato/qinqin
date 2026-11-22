<script lang="ts">
	// Settings → Layout, after the home widgets (#188): the phone navigation
	// (bottom bar or side menu) and the bottom bar's sections. The value is
	// the person's `nav-layout` row (lib/frame/navLayout.ts), one per account,
	// so it can be prepared on any device. Like the home widgets editor:
	// switches "In the bar", Move up / Move down (and drag for pointers), a
	// live preview of the bar, Reset to default. Changes show at once (the
	// frame follows navLayoutStore); saves queue one at a time and a failed
	// save says so and offers Retry / Discard.
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { barItems, MORE } from '$lib/frame/barItems';
	import {
		BAR_MAX_ITEMS,
		DEFAULT_BAR,
		PHONE_MODES,
		loadNavLayout,
		moveInBar,
		moveInBarTo,
		saveNavLayout,
		toggleInBar,
		type NavLayoutChange,
		type PhoneMode
	} from '$lib/frame/navLayout';
	import { navLayoutStore, type NavLayoutStore } from '$lib/frame/navLayoutStore.svelte';
	import { frameSections, homeSection, type FrameSection } from '$lib/frame/sections';
	import { loadPluginStates, pluginStates } from '$lib/plugins/states';
	import type { MessageKey } from '$lib/i18n';
	import Icon from '$lib/ui/Icon.svelte';
	import { Button, Panel, Section } from '$lib/ui';

	let {
		store = navLayoutStore,
		load = loadNavLayout,
		save = saveNavLayout
	}: {
		store?: NavLayoutStore;
		load?: typeof loadNavLayout;
		save?: typeof saveNavLayout;
	} = $props();

	const MODE_TEXT: Record<PhoneMode, { label: MessageKey; description: MessageKey }> = {
		bar: { label: 'settings.navLayout.mode.bar', description: 'settings.navLayout.mode.barDescription' },
		drawer: { label: 'settings.navLayout.mode.drawer', description: 'settings.navLayout.mode.drawerDescription' }
	};

	const ready = $derived($pluginStates.status === 'ready');
	const sections = $derived<FrameSection[]>([homeSection(), ...frameSections($pluginStates)]);
	const visibleIds = $derived(sections.map((s) => s.id));
	const phone = $derived(store.phone);
	const bar = $derived(store.bar);
	const preview = $derived(barItems(sections, bar, null));
	const fits = $derived(sections.length <= BAR_MAX_ITEMS);
	// The editor's rows: the visible pins in bar order, then the others in frame order.
	const pins = $derived(bar.flatMap((id) => sections.filter((s) => s.id === id)));
	const others = $derived(sections.filter((s) => !pins.includes(s)));
	const isDefault = $derived(JSON.stringify(bar) === JSON.stringify(DEFAULT_BAR));

	let announcement = $state('');
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	onMount(() => {
		if ($pluginStates.status === 'idle') void loadPluginStates();
		// Fresh from the server: another device may have changed it.
		load().then(
			(fresh) => {
				if (pending === null && !inFlight) store.set(fresh);
			},
			() => {}
		);
	});

	// One save at a time; changes made meanwhile are merged and sent next.
	let pending: NavLayoutChange | null = null;
	let unsaved: NavLayoutChange | null = null;
	let inFlight = false;

	async function persist(change: NavLayoutChange): Promise<void> {
		pending = { ...pending, ...change };
		saveStatus = 'saving';
		if (inFlight) return;
		inFlight = true;
		try {
			while (pending !== null) {
				const next: NavLayoutChange = { ...unsaved, ...pending };
				pending = null;
				try {
					await save(next);
					unsaved = null;
				} catch {
					unsaved = next;
				}
			}
		} finally {
			inFlight = false;
		}
		saveStatus = unsaved === null ? 'saved' : 'error';
		if (unsaved !== null) announcement = t('settings.navLayout.saveFailed');
	}

	function apply(change: NavLayoutChange, said: string): void {
		store.set({ phone: change.phone ?? store.phone, bar: change.bar ? [...change.bar] : [...store.bar] });
		announcement = said;
		void persist(change);
	}

	function retry(): void {
		if (unsaved) void persist({});
	}

	async function discard(): Promise<void> {
		unsaved = null;
		saveStatus = 'idle';
		announcement = t('settings.navLayout.discarded');
		try {
			store.set(await load());
		} catch {
			// Offline: what shows stays; the next change saves it all again.
		}
	}

	function chooseMode(mode: PhoneMode): void {
		apply({ phone: mode }, t('settings.navLayout.modeSaved', { mode: t(MODE_TEXT[mode].label) }));
	}

	function positionOf(id: string, list: readonly string[]): { position: number; count: number } {
		const shown = new Set(visibleIds);
		const order = list.filter((other) => shown.has(other));
		return { position: order.indexOf(id) + 1, count: order.length };
	}

	async function toggle(section: FrameSection, on: boolean): Promise<void> {
		apply(
			{ bar: toggleInBar(bar, section.id, on) },
			t(on ? 'settings.navLayout.added' : 'settings.navLayout.removed', { section: section.label })
		);
		await tick();
		document.getElementById(`bar-switch-${section.id}`)?.focus();
	}

	async function move(section: FrameSection, direction: -1 | 1): Promise<void> {
		const next = moveInBar(bar, section.id, direction, visibleIds);
		apply({ bar: next }, t('settings.navLayout.moved', { section: section.label, ...positionOf(section.id, next) }));
		await tick();
		const same = document.getElementById(`bar-${direction < 0 ? 'up' : 'down'}-${section.id}`);
		const other = document.getElementById(`bar-${direction < 0 ? 'down' : 'up'}-${section.id}`);
		if (same instanceof HTMLButtonElement && !same.disabled) same.focus();
		else other?.focus();
	}

	function reset(): void {
		apply({ bar: [...DEFAULT_BAR] }, t('settings.navLayout.wasReset'));
	}

	// Drag to reorder the pins: pointers only; the handle is not focusable
	// (Move up / Move down are the keyboard path).
	let drag = $state<{ id: string; pointerId: number; startY: number; dy: number; from: number; target: number } | null>(
		null
	);
	const rows: Record<string, HTMLLIElement> = {};

	function dragStart(event: PointerEvent, section: FrameSection): void {
		const from = pins.indexOf(section);
		if (event.button !== 0 || from < 0) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		drag = { id: section.id, pointerId: event.pointerId, startY: event.clientY, dy: 0, from, target: from };
	}

	function dragMove(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		drag.dy = event.clientY - drag.startY;
		let target = 0;
		for (const pin of pins) {
			if (pin.id === drag.id) continue;
			const box = rows[pin.id]?.getBoundingClientRect();
			if (box && box.top + box.height / 2 < event.clientY) target++;
		}
		drag.target = target;
	}

	function dragEnd(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const { id, from, target } = drag;
		drag = null;
		if (event.type !== 'pointerup' || target === from) return;
		const section = pins.find((pin) => pin.id === id);
		if (!section) return;
		const next = moveInBarTo(bar, id, target, visibleIds);
		apply({ bar: next }, t('settings.navLayout.moved', { section: section.label, ...positionOf(id, next) }));
	}
</script>

<h2 id="phone-navigation">{t('settings.navLayout.title')}</h2>
<p class="hint">{t('settings.navLayout.hint')}</p>

<p class="sr-only" aria-live="polite">{announcement}</p>

<fieldset class="modes">
	<legend class="sr-only">{t('settings.navLayout.title')}</legend>
	{#each PHONE_MODES as mode (mode)}
		<div class="mode">
			<input
				type="radio"
				name="phone-navigation"
				id="phone-navigation-{mode}"
				value={mode}
				checked={phone === mode}
				aria-describedby="phone-navigation-{mode}-description"
				onchange={() => chooseMode(mode)}
			/>
			<span>
				<label class="mode-name" for="phone-navigation-{mode}">{t(MODE_TEXT[mode].label)}</label>
				<span class="mode-description" id="phone-navigation-{mode}-description">{t(MODE_TEXT[mode].description)}</span>
			</span>
		</div>
	{/each}
</fieldset>

<div class="status">
	<span class="save-status">
		{#if saveStatus === 'saving'}{t('common.state.saving')}{:else if saveStatus === 'saved'}{t('settings.navLayout.saved')}{/if}
	</span>
</div>
{#if saveStatus === 'error'}
	<div class="save-error" role="alert">
		<p>{t('settings.navLayout.saveFailed')}</p>
		<Button onclick={retry}>{t('settings.navLayout.retry')}</Button>
		<Button variant="plain" onclick={discard}>{t('settings.navLayout.discard')}</Button>
	</div>
{/if}

<Section title={t('settings.navLayout.barTitle')} level={3} headingId="bottom-bar">
	<p class="hint" id="bar-rule">{fits ? t('settings.navLayout.ruleFits') : t('settings.navLayout.ruleMore')}</p>
	{#if phone === 'drawer'}<p class="hint">{t('settings.navLayout.drawerNote')}</p>{/if}

	{#if !ready}
		<p class="hint">{t('settings.navLayout.loading')}</p>
	{:else}
		<div class="toolbar">
			<Button disabled={isDefault} onclick={reset}>{t('settings.navLayout.reset')}</Button>
		</div>
		<ul class="items">
			{#each [...pins, ...others] as section (section.id)}
				{@const index = pins.indexOf(section)}
				{@const on = index >= 0}
				{@const underMore = on && !fits && index >= BAR_MAX_ITEMS - 1}
				<li
					class="item"
					class:off={!on}
					class:dragging={drag?.id === section.id}
					class:drop={drag !== null && drag.target !== drag.from && on && index === drag.target}
					style:transform={drag?.id === section.id ? `translateY(${drag.dy}px)` : undefined}
					bind:this={rows[section.id]}
				>
					{#if on && pins.length > 1}
						<span
							class="handle"
							aria-hidden="true"
							title={t('settings.navLayout.drag')}
							onpointerdown={(event) => dragStart(event, section)}
							onpointermove={dragMove}
							onpointerup={dragEnd}
							onpointercancel={dragEnd}
						>
							<svg viewBox="0 0 12 20" width="12" height="20" fill="currentColor">
								<circle cx="3" cy="4" r="1.6" /><circle cx="9" cy="4" r="1.6" />
								<circle cx="3" cy="10" r="1.6" /><circle cx="9" cy="10" r="1.6" />
								<circle cx="3" cy="16" r="1.6" /><circle cx="9" cy="16" r="1.6" />
							</svg>
						</span>
					{:else}
						<span class="handle" aria-hidden="true"></span>
					{/if}
					<span class="name">
						<Icon name={section.icon} />
						<strong id="bar-title-{section.id}">{section.label}</strong>
						{#if on}
							<span class="position" id="bar-position-{section.id}"
								>{underMore
									? t('settings.navLayout.underMore')
									: t('settings.navLayout.position', { position: index + 1, count: pins.length })}</span
							>
						{/if}
					</span>
					<span class="controls">
						<label class="switch">
							<input
								type="checkbox"
								role="switch"
								id="bar-switch-{section.id}"
								checked={on}
								aria-labelledby="bar-switch-label-{section.id} bar-title-{section.id}"
								aria-describedby={on ? `bar-position-${section.id}` : 'bar-rule'}
								onchange={(event) => toggle(section, event.currentTarget.checked)}
							/>
							<span class="track" aria-hidden="true"></span>
							<span id="bar-switch-label-{section.id}">{t('settings.navLayout.inBar')}</span>
						</label>
						{#if on}
							<span class="moves">
								<Button
									variant="plain"
									id="bar-up-{section.id}"
									disabled={index === 0}
									aria-label={t('settings.navLayout.moveUpLabel', { section: section.label })}
									onclick={() => move(section, -1)}>{t('settings.navLayout.moveUp')}</Button
								>
								<Button
									variant="plain"
									id="bar-down-{section.id}"
									disabled={index === pins.length - 1}
									aria-label={t('settings.navLayout.moveDownLabel', { section: section.label })}
									onclick={() => move(section, 1)}>{t('settings.navLayout.moveDown')}</Button
								>
							</span>
						{/if}
					</span>
				</li>
			{/each}
		</ul>

		<h4 class="preview-title">{t('settings.navLayout.preview')}</h4>
		<!-- Panel raised: the preview is a separate object (design §5). -->
		<Panel raised>
			<ol class="preview" aria-label={t('settings.navLayout.previewLabel')} style:--items={preview.items.length}>
				{#each preview.items as item (item === MORE ? '#more' : item.id)}
					<li>
						<Icon name={item === MORE ? 'more' : item.icon} />
						<span>{item === MORE ? t('nav.more') : item.label}</span>
					</li>
				{/each}
			</ol>
		</Panel>
	{/if}
</Section>

<style>
	h2 {
		margin-top: var(--space-6);
	}
	.hint {
		color: var(--readable-muted);
	}
	.modes {
		display: grid;
		gap: var(--space-2);
		margin: var(--space-3) 0 0;
		padding: 0;
		border: 0;
	}
	.mode {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		min-height: var(--hit);
	}
	.mode input {
		margin-top: 0.2rem;
	}
	.mode input:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.mode label {
		cursor: pointer;
	}
	.mode-name {
		display: block;
		font-weight: var(--weight-medium);
	}
	.mode-description {
		display: block;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}
	.status {
		min-height: 1.5rem;
	}
	.save-status {
		color: var(--readable-muted);
	}
	.save-error {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-block: var(--space-2);
	}
	.save-error p {
		flex-basis: 100%;
		margin-block: var(--space-2);
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
	.toolbar {
		display: flex;
		justify-content: flex-end;
		min-height: var(--hit);
	}
	/* One hairline row per section, not a card (design §5). */
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.item {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		padding-block: var(--space-2);
	}
	.item + .item {
		border-top: 1px solid var(--hair);
	}
	.item.off .name {
		color: var(--readable-muted);
	}
	.item.dragging {
		z-index: 1;
		box-shadow: var(--shadow-float);
	}
	.item.drop::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: -0.2rem;
		height: 3px;
		border-radius: 2px;
		background: var(--accent);
	}
	.handle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		min-height: var(--hit);
		margin-left: -0.35rem;
		cursor: grab;
		touch-action: none;
		color: var(--readable-muted);
	}
	.name {
		flex: 1 1 10rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		min-width: 0;
	}
	.name :global(svg) {
		color: var(--readable-muted);
	}
	.name strong {
		font-weight: var(--weight-medium);
	}
	.position {
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.moves {
		display: flex;
		gap: var(--space-2);
	}
	.switch {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
		cursor: pointer;
	}
	.switch input {
		position: absolute;
		top: 50%;
		left: 0;
		transform: translateY(-50%);
		width: 2.5rem;
		height: 1.4rem;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.track {
		position: relative;
		flex: none;
		width: 2.5rem;
		height: 1.4rem;
		border-radius: 999px;
		background: var(--line);
		transition: background var(--motion-fast) var(--ease-standard);
	}
	.track::after {
		content: '';
		position: absolute;
		top: 0.15rem;
		left: 0.15rem;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 50%;
		background: var(--panel);
		transition: transform var(--motion-fast) var(--ease-standard);
	}
	.switch input:checked + .track {
		background: var(--accent);
	}
	.switch input:checked + .track::after {
		transform: translateX(1.1rem);
	}
	.switch input:focus-visible + .track {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.preview-title {
		margin: var(--space-4) 0 var(--space-2);
		font-size: var(--font-size-label);
		font-weight: var(--weight-regular);
		color: var(--readable-muted);
	}
	/* A small copy of the bar: the same items, no links. */
	.preview {
		display: grid;
		grid-template-columns: repeat(var(--items), minmax(0, 1fr));
		max-width: 22rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.preview li {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.125rem;
		min-width: 0;
		padding-block: var(--space-1);
		color: var(--readable-muted);
		font-size: var(--font-size-xs);
	}
	.preview li span {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
</style>
