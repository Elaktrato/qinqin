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
	import { errorMessage } from '$lib/stats/errors';
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
	import { allWidgets } from '$lib/widgets/registry';
	import { currentLanguage } from '$lib/workspaces';

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
	let resetButton = $state<HTMLButtonElement | null>(null);
	let resetConfirm = $state<HTMLButtonElement | null>(null);

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
			loadError = errorMessage(err, t('settings.home.loadFailed'));
			loadStatus = 'error';
		}
	}

	onMount(() => {
		if ($pluginStates.status === 'idle') void loadPluginStates();
		void load();
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
			saveError = errorMessage(err, t('settings.home.noAnswer'));
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
	<button type="button" onclick={load}>{t('settings.home.retry')}</button>
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
				<button type="button" bind:this={resetConfirm} onclick={() => closeReset(true)}>{t('settings.home.reset')}</button>
				<button type="button" class="secondary" onclick={() => closeReset(false)}>{t('common.action.cancel')}</button>
			</span>
		{:else}
			<button
				type="button"
				class="secondary"
				bind:this={resetButton}
				disabled={isDefault}
				onclick={askReset}
			>
				{t('settings.home.resetLabel')}
			</button>
		{/if}
	</div>

	{#if saveStatus === 'error'}
		<div class="save-error" role="alert">
			<p>{t('settings.home.saveFailed', { reason: saveError })}</p>
			<button type="button" onclick={persist}>{t('settings.home.retry')}</button>
			<button type="button" class="secondary" onclick={discard}>{t('settings.home.discard')}</button>
		</div>
	{/if}

	{#if $pluginStates.status === 'loading' || $pluginStates.status === 'idle'}
		<p class="hint">{t('settings.home.loadingPlugins')}</p>
	{:else if $pluginStates.status === 'error'}
		<p class="error">
			{t('settings.home.pluginsFailed')}
			<button type="button" class="secondary" onclick={loadPluginStates}>{t('settings.home.retry')}</button>
		</p>
	{/if}

	<h3 id="home-on-heading">{t('settings.home.on')}</h3>
	{#if onItems.length === 0}
		<p class="hint">{t('settings.home.noWidgets')}</p>
	{:else}
		<ol class="items" aria-labelledby="home-on-heading">
			{#each onItems as item, index (item.widget.id)}
				{@render row(item, index)}
			{/each}
		</ol>
	{/if}

	{#if offItems.length > 0}
		<h3 id="home-off-heading">{t('settings.home.off')}</h3>
		<ul class="items" aria-labelledby="home-off-heading">
			{#each offItems as item, index (item.widget.id)}
				{@render row(item, index)}
			{/each}
		</ul>
	{/if}

	{#if parked.length > 0}
		<p class="hint parked">
			{#each parked as widget, index (widget.id)}{index > 0 ? ', ' : ''}<strong>{widget.title}</strong
				> ({widget.plugin}){/each}
			{t('settings.home.parked', { count: parked.length })}
		</p>
	{/if}

	<h3 id="home-preview-heading">{t('settings.home.preview')}</h3>
	<p class="hint">
		{language ? t('settings.home.previewHintLanguage', { language }) : t('settings.home.previewHint')}
	</p>
	{#if preview.length === 0}
		<p class="preview-empty">{t('settings.home.previewEmpty')}</p>
	{:else}
		<ol class="preview" aria-labelledby="home-preview-heading">
			{#each preview as { widget, span } (widget.id)}
				<li class:span>{widget.title}</li>
			{/each}
		</ol>
	{/if}
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
				<span class="owner">{ownerLabel(item.widget.owner)}</span>
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
					<button
						type="button"
						class="secondary move"
						id="widget-up-{id}"
						disabled={item.position === 1}
						aria-label={t('settings.home.moveUpLabel', { widget: item.widget.title })}
						onclick={() => move(item, -1)}>{t('settings.home.moveUp')}</button
					>
					<button
						type="button"
						class="secondary move"
						id="widget-down-{id}"
						disabled={item.position === item.onCount}
						aria-label={t('settings.home.moveDownLabel', { widget: item.widget.title })}
						onclick={() => move(item, 1)}>{t('settings.home.moveDown')}</button
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

	h3 {
		margin: 1.5rem 0 0.5rem;
		font-size: 1rem;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem 0.75rem;
		min-height: 2.75rem;
	}

	.save-status {
		margin-right: auto;
		color: var(--readable-muted);
	}

	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.item {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.5rem 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
		padding: 0.6rem 0.75rem;
		background: var(--panel);
	}

	.item.off {
		border-style: dashed;
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
		min-height: 2.75rem;
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
		gap: 0.25rem 0.5rem;
	}

	.owner,
	.position {
		font-size: 0.8rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
	}

	.position {
		border-color: transparent;
		color: var(--readable-muted);
	}

	.description,
	.reason {
		margin: 0.25rem 0 0;
	}

	.description {
		color: var(--readable-muted);
	}

	/* Why the widget does not apply: --text with the --warn bar as the cue. */
	.reason {
		font-size: 0.9rem;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--warn);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	/* The two move buttons wrap as a pair. */
	.moves {
		display: flex;
		gap: 0.5rem;
	}

	.switch {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.75rem;
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
		background: color-mix(in srgb, currentColor 30%, transparent);
		transition: background 0.15s;
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
		transition: transform 0.15s;
	}

	.switch input:checked + .track {
		background: var(--accent);
	}

	.switch input:checked + .track::after {
		transform: translateX(1.1rem);
	}

	.switch input:focus-visible + .track {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	button {
		font: inherit;
		padding: 0.45rem 0.85rem;
		border: 0;
		border-radius: 0.4rem;
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
		cursor: pointer;
	}

	button.secondary {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
		font-weight: 500;
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	button.move {
		min-height: 2.75rem;
		min-width: 2.75rem;
	}

	.error,
	.save-error p {
		margin: 0.5rem 0;
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.save-error {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0.5rem 0;
	}

	.save-error p {
		flex-basis: 100%;
	}

	.parked {
		margin-top: 0.75rem;
	}

	.preview {
		list-style: none;
		margin: 0;
		padding: 0.5rem;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.4rem;
		max-width: 28rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
		counter-reset: preview;
	}

	.preview li {
		counter-increment: preview;
		padding: 0.6rem 0.5rem;
		border-radius: 0.3rem;
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		font-size: 0.9rem;
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
