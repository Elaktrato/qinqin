<script lang="ts">
	// Settings → Appearance (design §7): mode, a theme and an accent per
	// light/dark slot, corners, spacing and the hanzi font. Every change
	// paints right away (a preview through the theme store); Save writes the
	// user-global `appearance` row; leaving unsaved returns to the saved look.
	// Native radio groups: arrow keys move within a group.
	import { onDestroy } from 'svelte';
	import { t, type MessageKey } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import {
		CORNERS,
		DEFAULT_APPEARANCE,
		HANZI_FONTS,
		MODES,
		SLOTS,
		SPACINGS,
		type Appearance,
		type Corners,
		type HanziFont,
		type Mode,
		type Slot,
		type Spacing
	} from '$lib/theme/appearance';
	import { fallbackTheme } from '$lib/theme/fallback';
	import { themeStore, type ThemeStore } from '$lib/theme/store.svelte';
	import { accentOptions, changeFrom, isDirty, previewOf, slotThemeGroups } from './appearanceForm';

	let { store = themeStore }: { store?: ThemeStore } = $props();

	function copy(a: Appearance): Appearance {
		return { ...a, light: { ...a.light }, dark: { ...a.dark } };
	}

	// svelte-ignore state_referenced_locally
	let draft = $state<Appearance>(copy(store.appearance));
	let editing = $state<Slot | null>(null);
	let touched = $state(false);
	let busy = $state(false);
	let status = $state('');
	let error = $state('');

	// Until the person edits, the form follows the saved row (it may arrive
	// after the page opened, or change from another device).
	$effect(() => {
		const saved = store.appearance;
		if (!touched) draft = copy(saved);
	});

	const dirty = $derived(isDirty(draft, store.appearance));
	const resolved = $derived(store.resolveFor(draft));

	const MODE_LABELS: Record<Mode, MessageKey> = {
		system: 'settings.appearance.mode.system',
		light: 'settings.appearance.mode.light',
		dark: 'settings.appearance.mode.dark'
	};
	const SLOT_LABELS: Record<Slot, MessageKey> = {
		light: 'settings.appearance.slot.light',
		dark: 'settings.appearance.slot.dark'
	};
	const CORNER_LABELS: Record<Corners, MessageKey> = {
		sharp: 'settings.appearance.corners.sharp',
		soft: 'settings.appearance.corners.soft',
		round: 'settings.appearance.corners.round'
	};
	const SPACING_LABELS: Record<Spacing, MessageKey> = {
		compact: 'settings.appearance.spacing.compact',
		comfortable: 'settings.appearance.spacing.comfortable'
	};
	const FONT_LABELS: Record<HanziFont, MessageKey> = {
		sans: 'settings.appearance.hanziFont.sans',
		serif: 'settings.appearance.hanziFont.serif',
		kai: 'settings.appearance.hanziFont.kai'
	};

	function update(next: Appearance, slot: Slot | null): void {
		touched = true;
		draft = next;
		editing = slot;
		status = '';
		error = '';
		store.setPreview(previewOf(next, slot));
	}

	function slotTheme(slot: Slot) {
		return store.themeOf(draft[slot].theme) ?? fallbackTheme(slot);
	}

	function pickTheme(slot: Slot, id: string): void {
		const theme = store.themeOf(id);
		const keep = draft[slot].accent;
		const accent = theme && keep !== null && store.accentChoicesOf(id).includes(keep) ? keep : null;
		update({ ...draft, [slot]: { theme: id, accent } }, slot);
	}

	function pickAccent(slot: Slot, key: string): void {
		update({ ...draft, [slot]: { ...draft[slot], accent: key } }, slot);
	}

	async function save(): Promise<void> {
		busy = true;
		error = '';
		status = '';
		try {
			await store.save(changeFrom(draft, store.appearance));
			touched = false;
			editing = null;
			store.setPreview(null);
			status = t('settings.appearance.saved');
		} catch {
			error = t('settings.appearance.saveFailed');
		} finally {
			busy = false;
		}
	}

	function discard(): void {
		touched = false;
		editing = null;
		draft = copy(store.appearance);
		store.setPreview(null);
		error = '';
		status = t('settings.appearance.discarded');
	}

	function reset(): void {
		update(copy(DEFAULT_APPEARANCE), null);
	}

	onDestroy(() => store.setPreview(null));
</script>

<section class="appearance" aria-labelledby="appearance-title">
	<h2 id="appearance-title">{t('settings.appearance.title')}</h2>
	<p class="hint">{t('settings.appearance.hint')}</p>
	{#if !store.themesLoaded}
		<p class="hint">{t('settings.appearance.themesOffline')}</p>
	{/if}

	<fieldset class="segmented">
		<legend>{t('settings.appearance.mode.legend')}</legend>
		{#each MODES as mode (mode)}
			<label
				><input
					type="radio"
					name="appearance-mode"
					value={mode}
					checked={draft.mode === mode}
					onchange={() => update({ ...draft, mode }, null)}
				/><span>{t(MODE_LABELS[mode])}</span></label
			>
		{/each}
		<p class="hint">{t('settings.appearance.mode.hint')}</p>
	</fieldset>

	{#each SLOTS as slot (slot)}
		<div class="slot">
			<fieldset class="themes">
				<legend>{t(SLOT_LABELS[slot])}</legend>
				{#each slotThemeGroups(store.themes, slot, draft[slot].theme) as group (group.family)}
					<div class="group">
						<span class="group-label" aria-hidden="true">{group.family || t('settings.appearance.noFamily')}</span>
						{#each group.themes as theme (theme.id)}
							<label class="chip"
								><input
									type="radio"
									name="appearance-theme-{slot}"
									value={theme.id}
									checked={resolved[slot].theme === theme.id}
									onchange={() => pickTheme(slot, theme.id)}
								/><span class="swatch" aria-hidden="true" style:background={theme.colors.panel}
									><i style:background={theme.accents[theme.defaultAccent]}></i></span
								><span>{theme.name}</span></label
							>
						{/each}
					</div>
				{/each}
			</fieldset>

			<fieldset class="accents">
				<legend>{t('settings.appearance.accent.legend', { slot: t(SLOT_LABELS[slot]) })}</legend>
				{#each accentOptions(slotTheme(slot)) as option (option.key)}
					<label class="accent" title={option.key}
						><input
							type="radio"
							name="appearance-accent-{slot}"
							value={option.key}
							aria-label={t('settings.appearance.accent.option', { name: option.key })}
							checked={resolved[slot].accent === option.key}
							onchange={() => pickAccent(slot, option.key)}
						/><span class="dot" aria-hidden="true" style:background={option.color}></span></label
					>
				{/each}
				<p class="hint">{t('settings.appearance.accent.hint')}</p>
			</fieldset>
		</div>
	{/each}

	<fieldset class="segmented">
		<legend>{t('settings.appearance.corners.legend')}</legend>
		{#each CORNERS as corners (corners)}
			<label
				><input
					type="radio"
					name="appearance-corners"
					value={corners}
					checked={draft.corners === corners}
					onchange={() => update({ ...draft, corners }, editing)}
				/><span>{t(CORNER_LABELS[corners])}</span></label
			>
		{/each}
	</fieldset>

	<fieldset class="segmented">
		<legend>{t('settings.appearance.spacing.legend')}</legend>
		{#each SPACINGS as spacing (spacing)}
			<label
				><input
					type="radio"
					name="appearance-spacing"
					value={spacing}
					checked={draft.spacing === spacing}
					onchange={() => update({ ...draft, spacing }, editing)}
				/><span>{t(SPACING_LABELS[spacing])}</span></label
			>
		{/each}
	</fieldset>

	<!-- Saved in the row now; nothing paints with it until the shared hanzi
	     font stacks land (#97 WEB-LATER tasks 11-13), so the group says so. -->
	<fieldset class="segmented" aria-describedby="appearance-hanzi-font-pending">
		<legend>{t('settings.appearance.hanziFont.legend')}</legend>
		{#each HANZI_FONTS as font (font)}
			<label
				><input
					type="radio"
					name="appearance-hanzi-font"
					value={font}
					checked={draft.hanziFont === font}
					onchange={() => update({ ...draft, hanziFont: font }, editing)}
				/><span>{t(FONT_LABELS[font])}</span></label
			>
		{/each}
		<p class="hint" id="appearance-hanzi-font-pending">{t('settings.appearance.hanziFont.pending')}</p>
	</fieldset>

	<section class="preview" aria-labelledby="appearance-preview-title">
		<h3 id="appearance-preview-title">{t('settings.appearance.preview.title')}</h3>
		<div class="sample">
			<p>{t('settings.appearance.preview.text')}</p>
			<p class="muted">{t('settings.appearance.preview.muted')}</p>
			<p class="reading">
				<Msg key="settings.appearance.preview.reading"
					>{#snippet fresh(text: string)}<span class="w-new w-end">{text}</span>{/snippet}{#snippet learning(
						text: string
					)}<span class="w-learning w-end">{text}</span>{/snippet}</Msg
				>
			</p>
			<div class="row">
				<span class="primary">{t('settings.appearance.preview.action')}</span>
				<span class="grade again">{t('study.grade.again')}</span>
				<span class="grade hard">{t('study.grade.hard')}</span>
				<span class="grade good">{t('study.grade.good')}</span>
				<span class="grade easy">{t('study.grade.easy')}</span>
			</div>
		</div>
	</section>

	{#if !store.rowLoaded}
		<p class="hint">{t('settings.appearance.notLoaded')}</p>
	{/if}
	<div class="actions">
		<button type="button" class="save" disabled={busy || !dirty || !store.rowLoaded} onclick={save}
			>{busy ? t('settings.appearance.saving') : t('settings.appearance.save')}</button
		>
		{#if dirty}
			<button type="button" disabled={busy} onclick={discard}>{t('settings.appearance.discard')}</button>
		{/if}
		<button type="button" disabled={busy} onclick={reset}>{t('settings.appearance.reset')}</button>
	</div>
	<!-- Always in the DOM, so the save and discard results are announced. -->
	<p class="status" role="status">{status}</p>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.appearance {
		display: grid;
		gap: var(--space-4);
	}
	.appearance h2,
	.appearance h3 {
		margin: 0;
	}
	.hint {
		margin: 0;
		color: var(--readable-muted);
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	legend {
		font-weight: 600;
		margin-bottom: var(--space-2);
		padding: 0;
	}
	fieldset > .hint {
		flex-basis: 100%;
		font-size: var(--font-size-s);
	}
	.slot {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid var(--hair);
		border-radius: var(--radius-large);
	}
	.group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		flex-basis: 100%;
	}
	.group-label {
		font-size: var(--font-size-xs);
		color: var(--readable-muted);
		min-width: 5.5rem;
	}

	/* A radio inside a label: chips and segments. The native radio stays
	   visible (state without colour), tinted with the accent. */
	.segmented label,
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--hair);
		border-radius: 999px;
		background: var(--raised);
		color: var(--text);
		cursor: pointer;
	}
	.segmented label:has(input:checked),
	.chip:has(input:checked) {
		border-color: var(--accent);
		background: var(--selected-wash);
	}
	input[type='radio'] {
		accent-color: var(--accent);
		margin: 0;
	}
	.swatch {
		display: inline-grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px var(--hair);
		forced-color-adjust: none;
	}
	.swatch i {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
	}

	/* Accent dots: the radio is visually hidden, the dot carries a ring when
	   checked and a focus ring from the radio's focus. */
	.accent {
		position: relative;
		display: inline-grid;
		place-items: center;
		cursor: pointer;
		border-radius: 50%;
	}
	.accent input {
		position: absolute;
		inset: 0;
		opacity: 0;
		margin: 0;
		cursor: pointer;
	}
	.dot {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		box-shadow: 0 0 0 2px var(--panel);
		forced-color-adjust: none;
	}
	.accent:has(input:checked) .dot {
		box-shadow:
			0 0 0 2px var(--panel),
			0 0 0 4px var(--text);
	}
	.accent:has(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 4px;
	}
	.segmented label:has(input:focus-visible),
	.chip:has(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	@media (forced-colors: active) {
		.accent:has(input:checked) .dot {
			outline: 3px solid Highlight;
			outline-offset: 2px;
		}
		.segmented label:has(input:checked),
		.chip:has(input:checked) {
			border-color: Highlight;
		}
	}

	.preview .sample {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-4);
		border: 1px solid var(--hair);
		border-radius: var(--radius-large);
		background: var(--panel);
		color: var(--text);
	}
	.preview p {
		margin: 0;
	}
	.preview .muted {
		color: var(--readable-muted);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.primary,
	.grade {
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius);
		font-weight: 600;
	}
	.primary {
		background: var(--accent);
		color: var(--on-accent);
	}
	.grade {
		border: 2px solid currentColor;
	}
	.grade.again {
		color: var(--grade-again);
	}
	.grade.hard {
		color: var(--grade-hard);
	}
	.grade.good {
		color: var(--grade-good);
	}
	.grade.easy {
		color: var(--grade-easy);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.actions button {
		font: inherit;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius);
		border: 1px solid var(--hair);
		background: var(--raised);
		color: var(--text);
		cursor: pointer;
	}
	.actions .save {
		background: var(--accent);
		color: var(--on-accent);
		border-color: var(--accent);
		font-weight: 600;
	}
	.actions button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.error {
		margin: 0;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
		color: var(--readable-bad);
		font-weight: 600;
	}
	.status {
		margin: 0;
	}
</style>
