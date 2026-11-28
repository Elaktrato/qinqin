<script lang="ts">
	import { t, type MessageKey } from '$lib/i18n';
	import type { ReaderDisplay, ReadingsMode } from './displaySettings';
	import { RUBY_SCALES, THRESHOLD_MAX, THRESHOLD_MIN } from './displaySettings';
	import type { ReaderFont } from './displaySettings';
	import type { Variant } from './variants';
	import type { HanziFont } from '$lib/theme/appearance';
	import Select from '$lib/ui/Select.svelte';
	import { useApp, useSession } from '$lib/context/context';
	import { STATS_ID, featureKnownOff } from '$lib/features';
	const app = useApp();
	const session = useSession();

	// `default` follows the app-wide hanzi font (#97); its label names the current one.
	const APP_FONT_LABELS: Record<HanziFont, MessageKey> = {
		sans: 'settings.appearance.hanziFont.sans',
		serif: 'settings.appearance.hanziFont.serif',
		kai: 'settings.appearance.hanziFont.kai'
	};

	// The reader's display settings, the rail's Display panel (#102). Controlled:
	// every change goes up as a patch, the parent owns the state and saves it.
	// `script` (Chinese books only) is the simplified / traditional choice that
	// sat above the text before; it is a browser preference, not a setting.
	let {
		display,
		hasBookRuby,
		showAll,
		onchange,
		ontoggleAll,
		script,
		error,
		notice
	}: {
		display: ReaderDisplay;
		/** The open book has ruby of its own. */
		hasBookRuby: boolean;
		showAll: boolean;
		onchange: (change: Partial<ReaderDisplay>) => void;
		ontoggleAll: () => void;
		script?: { value: Variant; error?: string; onchange: (value: Variant) => void };
		/** A failed display save, shown here because the page alert sits behind the phone sheet. */
		error?: string;
		/** A status (the readings failed), likewise unreachable behind the sheet. */
		notice?: string;
	} = $props();

	const id = $props.id();

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
		{ value: 'default', label: t('reader.display.fontApp', { font: t(APP_FONT_LABELS[app.theme.appearance.hanziFont]) }) },
		{ value: 'sans', label: t('reader.display.fontSans') },
		{ value: 'serif', label: t('reader.display.fontSerif') },
		{ value: 'kai', label: t('reader.display.fontKai') }
	]);
</script>

<div class="display">
	<div id="{id}-panel" class="panel" role="group" aria-label={t('reader.display.panel')}>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if notice}<p class="notice" role="status">{notice}</p>{/if}
		{#if script}
			<div class="script">
				<Select
					label={t('reader.book.script')}
					value={script.value}
					onchange={(event) => script.onchange(event.currentTarget.value as Variant)}
					options={[
						{ value: 'original', label: t('reader.book.original') },
						{ value: 'simplified', label: t('reader.book.simplified') },
						{ value: 'traditional', label: t('reader.book.traditional') }
					]}
				/>
				{#if script.error}<p class="error" role="alert">{script.error}</p>{/if}
			</div>
		{/if}
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
					<!-- The character map is a Stats page: no link while Stats is switched off (#295). -->
					{#if !featureKnownOff(STATS_ID, session.features)}<a href="/stats/characters">{t('reader.display.whatScore')}</a>{/if}
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

		<!-- Saved sentences (#279): off by default; the popup's Save this sentence works either way. -->
		<div class="save-sentences">
			<label class="row">
				<input
					type="checkbox"
					checked={display.saveSentences}
					aria-describedby="{id}-save-hint"
					onchange={(e) => onchange({ saveSentences: e.currentTarget.checked })}
				/>
				{t('reader.display.saveSentences')}
			</label>
			<p id="{id}-save-hint" class="hint">{t('reader.display.saveSentencesHint')}</p>
		</div>
	</div>
</div>

<style>
	.display {
		min-width: 0;
		max-width: 100%;
	}

	/* A rail panel (design §5): no box; groups separated by hairlines. */
	.panel {
		box-sizing: border-box;
		max-width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		font-size: var(--font-size-s);
	}

	.panel > :global(* + fieldset),
	.panel > :global(* + .threshold),
	.panel > :global(* + .save-sentences) {
		padding-top: var(--space-3);
		border-top: 1px solid var(--hair);
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
	}

	legend,
	.row {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2rem;
		overflow-wrap: anywhere;
	}

	.threshold,
	.save-sentences {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.threshold input[type='range'] {
		width: 100%;
		min-height: 2rem;
	}

	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--readable-muted);
	}

	.legend {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
	}

	.error {
		margin: var(--space-1) 0 0;
		color: var(--readable-bad);
	}

	.notice {
		margin: var(--space-1) 0 0;
		font-size: var(--font-size-xs);
		color: var(--readable-muted);
	}
</style>
