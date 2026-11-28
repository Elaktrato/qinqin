<script lang="ts">
	// A word (or character) introduced in a lesson (#222, Ruling 13): its form, its reading as the workspace's
	// romanisation setting allows (#284), its gloss and the device voice.
	import PlayButton from '$lib/components/PlayButton.svelte';
	import { studyLang } from '$lib/i18n/lang';
	import { t } from '$lib/i18n';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import type { WordInfo } from './flow';

	let { word, language, deviceVoice, heading }: { word: WordInfo; language: string; deviceVoice: boolean; heading: string } = $props();

	const roman = useRomanisation();
	const reading = $derived(roman.text(word.reading, language));
</script>

<section class="word" aria-label={heading}>
	<p class="kicker">{heading}</p>
	<p class="form" lang={studyLang(language) ?? language}>{word.form}</p>
	{#if reading}<p class="reading">{reading}</p>{/if}
	<p class="gloss">{word.gloss ?? t('courses.player.noGloss')}</p>
	<PlayButton clips={[]} speakText={word.form} lang={language} {deviceVoice} label={word.form} />
</section>

<style>
	.word {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		text-align: center;
	}

	.word p {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.kicker,
	.reading {
		color: var(--readable-muted);
	}

	.form {
		font-family: var(--font-hanzi);
		font-size: var(--font-size-xxl);
		line-height: var(--line-tight);
	}

	.gloss {
		font-size: var(--font-size-l);
	}
</style>
