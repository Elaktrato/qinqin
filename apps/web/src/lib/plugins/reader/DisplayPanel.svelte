<script lang="ts">
	import { tick } from 'svelte';
	import type { ReaderDisplay, ReadingsMode } from './displaySettings';
	import { RUBY_SCALES, THRESHOLD_MAX, THRESHOLD_MIN } from './displaySettings';
	import type { ReaderFont } from './fonts';

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
		{ value: 'never', label: 'Never' },
		{ value: 'always', label: 'Always' },
		{ value: 'smart', label: 'Smart (hide readings of words I know)' }
	];
	const SIZE_NAMES = ['Small', 'Medium', 'Large', 'Extra large'];
	const FONTS: { value: ReaderFont; label: string }[] = [
		{ value: 'default', label: 'Default' },
		{ value: 'sans', label: 'Sans' },
		{ value: 'serif', label: 'Serif' },
		{ value: 'kai', label: 'Kai' }
	];

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
		onclick={() => (open = !open)}>Display</button
	>
	{#if open}
		<!-- Escape closes the disclosure from anywhere inside it; the group itself is no widget. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div id="{id}-panel" class="panel" role="group" aria-label="Reading display" {onkeydown}>
			{#if hasBookRuby}
				<label class="row">
					<input
						type="checkbox"
						checked={display.bookRuby}
						onchange={(e) => onchange({ bookRuby: e.currentTarget.checked })}
					/>
					Book ruby (the reading marks printed in the book)
				</label>
			{/if}

			<fieldset>
				<legend>Readings over words</legend>
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

			{#if display.readings === 'smart'}
				<div class="threshold">
					<label for="{id}-threshold">Memory score that counts as known: {display.smartThreshold}</label>
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
						Hide readings of words with a memory score of {display.smartThreshold} or more.
						<a href="/stats/characters">What is the score?</a>
					</p>
				</div>
				<button type="button" aria-pressed={showAll} onclick={ontoggleAll}>Show all readings</button>
			{/if}

			<fieldset>
				<legend>Ruby size</legend>
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
				<legend>Font</legend>
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
</style>
