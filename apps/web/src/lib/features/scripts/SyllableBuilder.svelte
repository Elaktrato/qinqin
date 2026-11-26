<script lang="ts">
	// How a Hangul syllable block is built: first consonant + vowel (+ final consonant, the batchim).
	import { t } from '$lib/i18n';
	import PlayButton from '$lib/components/PlayButton.svelte';
	import Section from '$lib/ui/Section.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { composeSyllable, FINALS, INITIALS, MEDIALS, romanSyllable } from './hangul';
	import type { ScriptSystem } from './types';

	let { system, deviceVoice }: { system: ScriptSystem; deviceVoice: boolean } = $props();

	let initial = $state('ㄱ');
	let medial = $state('ㅏ');
	let final = $state('');

	const jamo = (list: readonly string[]) => list.map((j) => ({ value: j, label: j }));
	const finals = $derived([{ value: '', label: t('scripts.build.finalNone') }, ...jamo(FINALS)]);
	const block = $derived(composeSyllable(initial, medial, final === '' ? null : final));
	const roman = $derived(romanSyllable(block) ?? '');
</script>

<Section title={t('scripts.build.title')}>
	<p class="intro">{t('scripts.build.intro')}</p>
	<div class="pickers" lang={system.language}>
		<Select label={t('scripts.build.initial')} options={jamo(INITIALS)} bind:value={initial} />
		<Select label={t('scripts.build.vowel')} options={jamo(MEDIALS)} bind:value={medial} />
		<Select label={t('scripts.build.final')} options={finals} bind:value={final} />
	</div>
	<p class="result">
		<span class="block" lang={system.language}>{block}</span>
		<span>{t('scripts.build.result', { roman })}</span>
		<PlayButton clips={[]} speakText={block} lang={system.language} {deviceVoice} label={block} />
	</p>
</Section>

<style>
	.intro {
		margin: 0 0 var(--space-3);
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}

	.pickers {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: var(--space-3);
		max-width: 32rem;
	}

	.result {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: var(--space-3) 0 0;
	}

	.block {
		font-size: var(--font-size-xxl);
	}
</style>
