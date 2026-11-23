<script lang="ts">
	import { pluginName } from '$lib/plugins/manifestText';
	// Settings → Home: which widgets the home page shows, and in what
	// order. The layout is one list per user (every workspace and device
	// shares it), so widgets that do not apply to the active workspace's
	// language are still listed and can be switched; the editor changes
	// the stored list, keeping the ids of widgets that are unavailable
	// right now (lib/widgets/editor.ts). Saves are optimistic: the change
	// shows at once, a failed save says so and offers Retry.
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { errorText } from '$lib/api/apiErrors';
	import { languageLabel } from '$lib/languages';
	import { coreFeatures } from '$lib/features';
	import { pluginState, webPlugins } from '$lib/plugins';
	import { loadPluginStates, pluginStates } from '$lib/plugins/states';
	import {
		displayItems,
		editableLayout,
		moveWidget,
		moveWidgetTo,
		resetLayout,
		toggleWidget,
		type EditorItem
	} from '$lib/widgets/editor';
	import { DEFAULT_LAYOUT, loadLayout, placeWidgets, resolveLayout, saveLayout } from '$lib/widgets/layout';
	import { coreWidgets } from '$lib/widgets/core';
	import {
		DEFAULT_HEATMAP_LAYOUT,
		HEATMAP_LAYOUTS,
		loadWidgetOptions,
		saveHeatmapLayout,
		type HeatmapLayout
	} from '$lib/widgets/options';
	import type { MessageKey } from '$lib/i18n';
	import { allWidgets } from '$lib/widgets/registry';
	import { currentLanguage } from '$lib/workspaces';
	import { Button, Chip, Panel, Section } from '$lib/ui';

	// The layout as the editor shows it (null = nothing stored, so the
	// default) and the last one the server confirmed, for Discard.
	let stored = $state<string[] | null>(null);
	let confirmed = $state<string[] | null>(null);
	let loadStatus = $state<'loading' | 'ready' | 'error'>('loading');
	let loadError = $state('');

	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveError = $state('');
	let announcement = $state('');
	let confirmingReset = $state(false);
	let resetButton = $state<HTMLElement | undefined>(undefined);
	let resetConfirm = $state<HTMLElement | undefined>(undefined);

	// The home heatmap's layout (the `widget-options` row, separate from the
	// layout): saved on change, re-read before the write so other keys survive.
	let heatmapLayout = $state<HeatmapLayout>(DEFAULT_HEATMAP_LAYOUT);
	let layoutError = $state('');
	const LAYOUT_TEXT: Record<HeatmapLayout, { label: MessageKey; description: MessageKey }> = {
		garden: { label: 'settings.home.layout.garden', description: 'settings.home.layout.gardenDescription' },
		month: { label: 'settings.home.layout.month', description: 'settings.home.layout.monthDescription' },
		week: { label: 'settings.home.layout.week', description: 'settings.home.layout.weekDescription' }
	};

	// The layout the server last confirmed: where a failed newest save goes back to.
	let savedLayout: HeatmapLayout = DEFAULT_HEATMAP_LAYOUT;

	async function loadOptions(): Promise<void> {
		try {
			heatmapLayout = savedLayout = (await loadWidgetOptions()).heatmapLayout;
		} catch (err) {
			// The garden stays checked; a save still re-reads the row first.
			console.warn('widget options not loaded', err);
		}
	}

	// Layout saves queue like the widget layout's (persist below): one at a
	// time, always of the newest choice. A failed earlier save is superseded by
	// the newer one; only a failed newest save resets the radio, to the last
	// layout the server confirmed (#100 review).
	let layoutInFlight = false;
	let layoutPending = false;

	async function chooseLayout(next: HeatmapLayout): Promise<void> {
		heatmapLayout = next;
		layoutError = '';
		if (layoutInFlight) {
			layoutPending = true;
			return;
		}
		layoutInFlight = true;
		let failure: unknown = null;
		try {
			do {
				layoutPending = false;
				const value = heatmapLayout;
				try {
					await saveHeatmapLayout(value);
					savedLayout = value;
					failure = null;
				} catch (err) {
					failure = err;
				}
			} while (layoutPending);
		} finally {
			layoutInFlight = false;
		}
		if (failure === null) {
			announcement = t('settings.home.layoutSaved', { layout: t(LAYOUT_TEXT[heatmapLayout].label) });
		} else {
			heatmapLayout = savedLayout;
			layoutError = t('settings.home.layoutSaveFailed', { reason: errorText(failure, t('settings.home.noAnswer')) });
			announcement = layoutError;
		}
	}

	// Every widget owner this build knows: the core features, then the plugins.
	const owners = [...coreFeatures, ...webPlugins];
	const states = $derived($pluginStates.status === 'ready' ? $pluginStates.list : []);
	// Every enabled plugin's widgets, whatever the language: the layout
	// is global, so a Chinese-only widget can be placed from a Spanish
	// workspace too.
	const all = $derived(allWidgets(webPlugins, states, null));
	const listed = $derived(all.filter((widget) => widget.surfaces.includes('home')).map((w) => w.id));
	const items = $derived(displayItems(stored, all, $currentLanguage));
	const onItems = $derived(items.filter((item) => item.on));
	const offItems = $derived(items.filter((item) => !item.on));
	const language = $derived($currentLanguage ? languageLabel($currentLanguage) : '');
	const preview = $derived(
		placeWidgets(
			resolveLayout(stored, allWidgets(webPlugins, states, $currentLanguage), 'home')
		)
	);
	const isDefault = $derived(
		JSON.stringify(editableLayout(stored)) === JSON.stringify([...DEFAULT_LAYOUT])
	);

	// Stored ids of widgets this build knows but whose plugin is disabled
	// (or not installed): they stay in the layout and come back with it.
	const parked = $derived.by(() => {
		if ($pluginStates.status !== 'ready') return [];
		const shown = new Set(listed);
		return editableLayout(stored).flatMap((id) => {
			if (shown.has(id)) return [];
			for (const plugin of owners) {
				const widget = plugin.manifest.widgets?.find((w) => w.id === id);
				if (widget) return [{ id, title: widget.title, plugin: pluginName(plugin.manifest) }];
			}
			return [];
		});
	});

	// The default layout's titles, from every widget this build knows.
	const defaultTitles = $derived.by(() => {
		const known = [...coreWidgets, ...owners.flatMap((p) => p.manifest.widgets ?? [])];
		return DEFAULT_LAYOUT.map((id) => known.find((w) => w.id === id)?.title ?? id).reduce((before, after) =>
			t('settings.home.thenJoin', { before, after })
		);
	});

	function ownerLabel(owner: string): string {
		if (owner === 'core') return t('settings.home.core');
		const plugin = owners.find((p) => p.manifest.id === owner);
		if (plugin) return pluginName(plugin.manifest);
		const name = pluginState(owner, states)?.manifest?.name;
		return pluginName({ id: owner, name: typeof name === 'string' && name.trim() ? name : owner });
	}

	async function load(): Promise<void> {
		loadStatus = 'loading';
		loadError = '';
		try {
			stored = await loadLayout();
			confirmed = stored;
			loadStatus = 'ready';
		} catch (err) {
			loadError = errorText(err, t('settings.home.loadFailed'));
			loadStatus = 'error';
		}
	}

	onMount(() => {
		if ($pluginStates.status === 'idle') void loadPluginStates();
		void load();
		void loadOptions();
	});

	// One save at a time, and always of the newest layout: changes made
	// while a save is in flight are sent right after it, so the last
	// change is the one the server keeps.
	let inFlight = false;
	let pending = false;

	async function persist(): Promise<void> {
		saveStatus = 'saving';
		saveError = '';
		if (inFlight) {
			pending = true;
			return;
		}
		inFlight = true;
		try {
			do {
				pending = false;
				const value = editableLayout(stored);
				await saveLayout(value);
				confirmed = value;
			} while (pending);
			saveStatus = 'saved';
		} catch (err) {
			pending = false;
			saveError = errorText(err, t('settings.home.noAnswer'));
			saveStatus = 'error';
		} finally {
			inFlight = false;
		}
	}

	function apply(next: string[], said: string): void {
		stored = next;
		announcement = said;
		void persist();
	}

	function discard(): void {
		stored = confirmed;
		saveStatus = 'idle';
		saveError = '';
		announcement = t('settings.home.discarded');
	}

	function positionOf(id: string, layout: string[]): { position: number; count: number } {
		const onIds = displayItems(layout, all, null)
			.filter((item) => item.on)
			.map((item) => item.widget.id);
		return { position: onIds.indexOf(id) + 1, count: onIds.length };
	}

	async function toggle(item: EditorItem, on: boolean): Promise<void> {
		const next = toggleWidget(stored, item.widget.id, on);
		const { position, count } = positionOf(item.widget.id, next);
		apply(
			next,
			on
				? t('settings.home.added', { widget: item.widget.title, position, count })
				: t('settings.home.removed', { widget: item.widget.title })
		);
		// The row moved between the groups: keep focus on its switch.
		await tick();
		document.getElementById(`widget-switch-${item.widget.id}`)?.focus();
	}

	function movedMessage(item: EditorItem, next: string[]): string {
		const { position, count } = positionOf(item.widget.id, next);
		return t('settings.home.moved', { widget: item.widget.title, position, count });
	}

	async function move(item: EditorItem, direction: -1 | 1): Promise<void> {
		const next = moveWidget(stored, item.widget.id, direction, listed);
		apply(next, movedMessage(item, next));
		// Keep focus on the button pressed; at an end it is disabled now,
		// so the other one takes it.
		await tick();
		const id = item.widget.id;
		const same = document.getElementById(`widget-${direction < 0 ? 'up' : 'down'}-${id}`);
		const other = document.getElementById(`widget-${direction < 0 ? 'down' : 'up'}-${id}`);
		if (same instanceof HTMLButtonElement && !same.disabled) same.focus();
		else other?.focus();
	}

	async function askReset(): Promise<void> {
		confirmingReset = true;
		await tick();
		resetConfirm?.focus();
	}

	async function closeReset(reset: boolean): Promise<void> {
		confirmingReset = false;
		if (reset) apply(resetLayout(), t('settings.home.wasReset'));
		await tick();
		resetButton?.focus();
	}

	// Drag to reorder: an enhancement for pointers only. The handle is not
	// focusable; the Move up / Move down buttons are the full keyboard path.
	let drag = $state<{
		id: string;
		pointerId: number;
		startY: number;
		dy: number;
		from: number;
		target: number;
	} | null>(null);
	const rows: Record<string, HTMLLIElement> = {};

	function dragStart(event: PointerEvent, item: EditorItem): void {
		if (event.button !== 0 || item.position === null) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag = {
			id: item.widget.id,
			pointerId: event.pointerId,
			startY: event.clientY,
			dy: 0,
			from: item.position - 1,
			target: item.position - 1
		};
	}

	function dragMove(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		drag.dy = event.clientY - drag.startY;
		// The target is how many other rows have their middle above the
		// pointer; the other rows do not move while dragging.
		let target = 0;
		for (const item of onItems) {
			if (item.widget.id === drag.id) continue;
			const box = rows[item.widget.id]?.getBoundingClientRect();
			if (box && box.top + box.height / 2 < event.clientY) target++;
		}
		drag.target = target;
	}

	function dragEnd(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const { id, from, target } = drag;
		drag = null;
		if (event.type !== 'pointerup' || target === from) return;
		const item = onItems.find((candidate) => candidate.widget.id === id);
		if (!item) return;
		const next = moveWidgetTo(stored, id, target, listed);
		apply(next, movedMessage(item, next));
	}

	function dropMark(index: number): 'before' | 'after' | null {
		if (!drag || drag.target === drag.from || index !== drag.target) return null;
		return drag.target < drag.from ? 'before' : 'after';
	}
</script>

<h2>{t('settings.home.title')}</h2>
<p class="hint">{t('settings.home.hint')}</p>

<p class="sr-only" aria-live="polite">{announcement}</p>

{#if loadStatus === 'loading'}
	<p>{t('settings.home.loading')}</p>
{:else if loadStatus === 'error'}
	<p class="error" role="alert">{loadError}</p>
	<Button onclick={load}>{t('settings.home.retry')}</Button>
{:else}
	<div class="toolbar">
		<span class="save-status" class:failed={saveStatus === 'error'}>
			{#if saveStatus === 'saving'}
				{t('common.state.saving')}
			{:else if saveStatus === 'saved'}
				{t('settings.home.saved')}
			{/if}
		</span>
		{#if confirmingReset}
			<span class="confirm" role="group" aria-label={t('settings.home.resetLabel')}>
				<span>{t('settings.home.resetConfirm', { widgets: defaultTitles })}</span>
				<Button bind:element={resetConfirm} onclick={() => closeReset(true)}>{t('settings.home.reset')}</Button>
				<Button variant="plain" onclick={() => closeReset(false)}>{t('common.action.cancel')}</Button>
			</span>
		{:else}
			<Button bind:element={resetButton} disabled={isDefault} onclick={askReset}>
				{t('settings.home.resetLabel')}
			</Button>
		{/if}
	</div>

	{#if saveStatus === 'error'}
		<div class="save-error" role="alert">
			<p>{t('settings.home.saveFailed', { reason: saveError })}</p>
			<Button onclick={persist}>{t('settings.home.retry')}</Button>
			<Button variant="plain" onclick={discard}>{t('settings.home.discard')}</Button>
		</div>
	{/if}

	{#if $pluginStates.status === 'loading' || $pluginStates.status === 'idle'}
		<p class="hint">{t('settings.home.loadingPlugins')}</p>
	{:else if $pluginStates.status === 'error'}
		<p class="error">
			{t('settings.home.pluginsFailed')}
			<Button variant="plain" onclick={loadPluginStates}>{t('settings.home.retry')}</Button>
		</p>
	{/if}

	<Section title={t('settings.home.on')} level={3}>
		{#if onItems.length === 0}
			<p class="hint">{t('settings.home.noWidgets')}</p>
		{:else}
			<ol class="items">
				{#each onItems as item, index (item.widget.id)}
					{@render row(item, index)}
				{/each}
			</ol>
		{/if}
	</Section>

	{#if offItems.length > 0}
		<Section title={t('settings.home.off')} level={3}>
			<ul class="items">
				{#each offItems as item, index (item.widget.id)}
					{@render row(item, index)}
				{/each}
			</ul>
		</Section>
	{/if}

	{#if parked.length > 0}
		<p class="hint parked">
			{#each parked as widget, index (widget.id)}{index > 0 ? ', ' : ''}<strong>{widget.title}</strong
				> ({widget.plugin}){/each}
			{t('settings.home.parked', { count: parked.length })}
		</p>
	{/if}

	<Section title={t('settings.home.preview')} level={3}>
		<p class="hint">
			{language ? t('settings.home.previewHintLanguage', { language }) : t('settings.home.previewHint')}
		</p>
		{#if preview.length === 0}
			<p class="preview-empty">{t('settings.home.previewEmpty')}</p>
		{:else}
			<!-- Panel raised: the arrangement preview is a separate object (#106). -->
			<Panel raised>
				<ol class="preview">
					{#each preview as { widget, span } (widget.id)}
						<li class:span>{widget.title}</li>
					{/each}
				</ol>
			</Panel>
		{/if}
	</Section>
{/if}

{#snippet row(item: EditorItem, index: number)}
	{@const id = item.widget.id}
	{@const mark = item.on ? dropMark(index) : null}
	<li
		class="item"
		class:off={!item.on}
		class:dragging={drag?.id === id}
		class:drop-before={mark === 'before'}
		class:drop-after={mark === 'after'}
		style:transform={drag?.id === id ? `translateY(${drag.dy}px)` : undefined}
		bind:this={rows[id]}
	>
		{#if item.on && onItems.length > 1}
			<span
				class="handle"
				aria-hidden="true"
				title={t('settings.home.drag')}
				onpointerdown={(event) => dragStart(event, item)}
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
		{/if}
		<div class="text">
			<div class="title-row">
				<strong id="widget-title-{id}">{item.widget.title}</strong>
				<Chip>{ownerLabel(item.widget.owner)}</Chip>
				{#if item.position !== null}
					<span class="position">{t('settings.home.position', { position: item.position, count: item.onCount })}</span>
				{/if}
			</div>
			<p class="description" id="widget-description-{id}">{item.widget.description}</p>
			{#if !item.applies}
				<p class="reason" id="widget-reason-{id}">
					{t('settings.home.notFor', { language })}
					{item.on ? t('settings.home.hiddenHere') : t('settings.home.ifAdded')}
				</p>
			{/if}
			{#if id === 'activity-heatmap' && item.on}
				<fieldset class="heatmap-layout">
					<legend>{t('settings.home.heatmapLayout')}</legend>
					{#each HEATMAP_LAYOUTS as option (option)}
						<div class="layout-option">
							<input
								type="radio"
								name="heatmap-layout"
								id="heatmap-layout-{option}"
								value={option}
								checked={heatmapLayout === option}
								aria-describedby="heatmap-layout-{option}-description"
								onchange={() => chooseLayout(option)}
							/>
							<span>
								<label class="layout-name" for="heatmap-layout-{option}">{t(LAYOUT_TEXT[option].label)}</label>
								<span class="layout-description" id="heatmap-layout-{option}-description">
									{t(LAYOUT_TEXT[option].description)}
								</span>
							</span>
						</div>
					{/each}
					<p class="layout-note">{t('settings.home.layoutStats')}</p>
					{#if layoutError}
						<p class="error">{layoutError}</p>
					{/if}
				</fieldset>
			{/if}
		</div>
		<div class="controls">
			<label class="switch">
				<input
					type="checkbox"
					role="switch"
					id="widget-switch-{id}"
					checked={item.on}
					aria-labelledby="widget-switch-label-{id} widget-title-{id}"
					aria-describedby="widget-description-{id}{item.applies ? '' : ` widget-reason-${id}`}"
					onchange={(event) => toggle(item, event.currentTarget.checked)}
				/>
				<span class="track" aria-hidden="true"></span>
				<span id="widget-switch-label-{id}">{t('settings.home.on')}</span>
			</label>
			{#if item.on}
				<span class="moves">
					<Button
						variant="plain"
						id="widget-up-{id}"
						disabled={item.position === 1}
						aria-label={t('settings.home.moveUpLabel', { widget: item.widget.title })}
						onclick={() => move(item, -1)}>{t('settings.home.moveUp')}</Button
					>
					<Button
						variant="plain"
						id="widget-down-{id}"
						disabled={item.position === item.onCount}
						aria-label={t('settings.home.moveDownLabel', { widget: item.widget.title })}
						onclick={() => move(item, 1)}>{t('settings.home.moveDown')}</Button
					>
				</span>
			{/if}
		</div>
	</li>
{/snippet}

<style>
	.hint {
		color: var(--readable-muted);
	}

	.heatmap-layout {
		display: grid;
		gap: var(--space-2);
		margin: var(--space-3) 0 0;
		padding: 0;
		border: 0;
	}

	.heatmap-layout legend {
		padding: 0;
		margin-bottom: var(--space-2);
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.layout-option {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.layout-option label {
		cursor: pointer;
	}

	.layout-option input {
		margin-top: 0.2rem;
	}

	.layout-option input:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.layout-name {
		display: block;
		font-weight: var(--weight-medium);
	}

	.layout-description,
	.layout-note {
		display: block;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.layout-note {
		margin: 0;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2) var(--space-3);
		min-height: var(--hit);
	}

	.save-status {
		margin-right: auto;
		color: var(--readable-muted);
	}

	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	/* One hairline row per widget, not a card (#106). */
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.item {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-2) var(--space-3);
		padding-block: var(--space-3);
	}

	.item + .item {
		border-top: 1px solid var(--hair);
	}

	.item.off .title-row {
		color: var(--readable-muted);
	}

	.item.dragging {
		z-index: 1;
		box-shadow: var(--shadow-float);
	}

	.item.drop-before::before,
	.item.drop-after::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 3px;
		border-radius: 2px;
		background: var(--accent);
	}

	.item.drop-before::before {
		top: -0.3rem;
	}

	.item.drop-after::after {
		bottom: -0.3rem;
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

	.dragging .handle {
		cursor: grabbing;
	}

	.text {
		flex: 1 1 14rem;
		min-width: 0;
	}

	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
	}

	.position {
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.description,
	.reason {
		margin: var(--space-1) 0 0;
	}

	.description {
		color: var(--readable-muted);
	}

	/* Why the widget does not apply: --text with the --warn bar as the cue. */
	.reason {
		font-size: var(--font-size-s);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--warn);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	/* The two move buttons wrap as a pair. */
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

	/* A switch drawn over the real checkbox, which stays focusable and
	   clickable (opacity 0, same box as the track). */
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

	.error,
	.save-error p {
		margin-block: var(--space-2);
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
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
	}

	.parked {
		margin-top: var(--space-3);
	}

	.preview {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-1);
		max-width: 28rem;
		counter-reset: preview;
	}

	.preview li {
		counter-increment: preview;
		padding: var(--space-2);
		border-radius: var(--radius);
		background: var(--accent-14);
		font-size: var(--font-size-s);
		overflow-wrap: anywhere;
	}

	.preview li::before {
		content: counter(preview) '. ';
		color: var(--readable-muted);
	}

	.preview li.span {
		grid-column: 1 / -1;
	}

	.preview-empty {
		color: var(--readable-muted);
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
