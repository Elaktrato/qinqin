<script lang="ts">
	import { t, type MessageKey } from '$lib/i18n';
	import { tick } from 'svelte';
	import type { ReaderDisplay, ReadingsMode } from './displaySettings';
	import { RUBY_SCALES, THRESHOLD_MAX, THRESHOLD_MIN } from './displaySettings';
	import type { ReaderFont } from './fonts';
	import { themeStore } from '$lib/theme/store.svelte';
	import type { HanziFont } from '$lib/theme/appearance';

	// `default` follows the app-wide hanzi font (#97); its label names the current one.
	const APP_FONT_LABELS: Record<HanziFont, MessageKey> = {
		sans: 'settings.appearance.hanziFont.sans',
		serif: 'settings.appearance.hanziFont.serif',
		kai: 'settings.appearance.hanziFont.kai'
	};

	// The reader's display settings in a non-modal disclosure. Controlled:
	// every change goes up as a patch, the parent owns the state and saves it.
	let {
		display,
		hasBookRuby,
		showAll,
		onchange,
		ontoggleAll
	}: {
		display: ReaderDisplay;
		/** The open book has ruby of its own. */
		hasBookRuby: boolean;
		showAll: boolean;
		onchange: (change: Partial<ReaderDisplay>) => void;
		ontoggleAll: () => void;
	} = $props();

	const id = $props.id();
	let open = $state(false);
	let button = $state<HTMLButtonElement | null>(null);

	const MODES: { value: ReadingsMode; label: string }[] = [
		{ value: 'never', label: t('reader.display.never') },
		{ value: 'always', label: t('reader.display.always') },
		{ value: 'smart', label: t('reader.display.smart') }
	];
	const SIZE_NAMES = [
		t('reader.display.small'),
		t('reader.display.medium'),
		t('reader.display.large'),
		t('reader.display.extraLarge')
	];
	const FONTS: { value: ReaderFont; label: string }[] = $derived([
		{ value: 'default', label: t('reader.display.fontApp', { font: t(APP_FONT_LABELS[themeStore.appearance.hanziFont]) }) },
		{ value: 'sans', label: t('reader.display.fontSans') },
		{ value: 'serif', label: t('reader.display.fontSerif') },
		{ value: 'kai', label: t('reader.display.fontKai') }
	]);

	async function onkeydown(e: KeyboardEvent): Promise<void> {
		if (e.key !== 'Escape' || e.isComposing) return;
		e.preventDefault();
		e.stopPropagation();
		open = false;
		await tick();
		button?.focus();
	}
</script>

<div class="display">
	<button
		type="button"
		bind:this={button}
		aria-expanded={open}
		aria-controls="{id}-panel"
		onclick={() => (open = !open)}>{t('reader.display.button')}</button
	>
	{#if open}
		<!-- Escape closes the disclosure from anywhere inside it; the group itself is no widget. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div id="{id}-panel" class="panel" role="group" aria-label={t('reader.display.panel')} {onkeydown}>
			{#if hasBookRuby}
				<label class="row">
					<input
						type="checkbox"
						checked={display.bookRuby}
						onchange={(e) => onchange({ bookRuby: e.currentTarget.checked })}
					/>
					{t('reader.display.bookRuby')}
				</label>
			{/if}

			<fieldset>
				<legend>{t('reader.display.readings')}</legend>
				{#each MODES as mode (mode.value)}
					<label class="row">
						<input
							type="radio"
							name="{id}-readings"
							value={mode.value}
							checked={display.readings === mode.value}
							onchange={() => onchange({ readings: mode.value })}
						/>
						{mode.label}
					</label>
				{/each}
			</fieldset>

			<label class="row">
				<input
					type="checkbox"
					checked={display.highlightWords}
					aria-describedby={display.highlightWords ? `${id}-legend` : undefined}
					onchange={(e) => onchange({ highlightWords: e.currentTarget.checked })}
				/>
				{t('reader.display.markWords')}
			</label>
			{#if display.highlightWords}
				<ul id="{id}-legend" class="legend">
					<li><span class="w-new w-end" aria-hidden="true">字</span> {t('reader.display.legendNew')}</li>
					<li><span class="w-learning w-end" aria-hidden="true">字</span> {t('reader.display.legendLearning')}</li>
					<li class="hint">{t('reader.display.legendKnown')}</li>
				</ul>
			{/if}

			{#if display.readings === 'smart' || display.highlightWords}
				<div class="threshold">
					<label for="{id}-threshold">{t('reader.display.threshold', { score: display.smartThreshold })}</label
					>
					<input
						id="{id}-threshold"
						type="range"
						min={THRESHOLD_MIN}
						max={THRESHOLD_MAX}
						step="5"
						value={display.smartThreshold}
						aria-describedby="{id}-hint"
						oninput={(e) => onchange({ smartThreshold: Number(e.currentTarget.value) })}
					/>
					<p id="{id}-hint" class="hint">
						{#if display.readings === 'smart'}
							{t('reader.display.hideReadings', { score: display.smartThreshold })}
						{/if}
						{t('reader.display.markedKnown')}
						<a href="/stats/characters">{t('reader.display.whatScore')}</a>
					</p>
				</div>
			{/if}
			{#if display.readings === 'smart'}
				<button type="button" aria-pressed={showAll} onclick={ontoggleAll}>{t('reader.display.showAll')}</button>
			{/if}

			<fieldset>
				<legend>{t('reader.display.rubySize')}</legend>
				{#each RUBY_SCALES as scale, i (scale)}
					<label class="row">
						<input
							type="radio"
							name="{id}-size"
							value={scale}
							checked={display.rubyScale === scale}
							onchange={() => onchange({ rubyScale: scale })}
						/>
						{SIZE_NAMES[i]}
					</label>
				{/each}
			</fieldset>

			<fieldset>
				<legend>{t('reader.display.font')}</legend>
				{#each FONTS as font (font.value)}
					<label class="row">
						<input
							type="radio"
							name="{id}-font"
							value={font.value}
							checked={display.font === font.value}
							onchange={() => onchange({ font: font.value })}
						/>
						{font.label}
					</label>
				{/each}
			</fieldset>
		</div>
	{/if}
</div>

<style>
	.display {
		min-width: 0;
		max-width: 100%;
	}

	.panel {
		box-sizing: border-box;
		max-width: 100%;
		margin-top: 0.5rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		font-size: 0.95rem;
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
	}

	legend {
		padding: 0;
		font-weight: 600;
		margin-bottom: 0.15rem;
	}

	.row {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2rem;
		overflow-wrap: anywhere;
	}

	.threshold {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.threshold input[type='range'] {
		width: 100%;
		min-height: 2rem;
	}

	.hint {
		margin: 0;
		font-size: 0.85rem;
	}

	.legend {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		font-size: 0.9rem;
	}
</style>
