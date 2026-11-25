<script lang="ts">
	import ReadingText from '$lib/components/ReadingText.svelte';
	import { studyLang } from '$lib/i18n/lang';
	import type { Reading } from '$lib/api/types';
	import type { AudioClip } from '$lib/api/audio';
	import { t } from '$lib/i18n';
	import PlayButton from '$lib/components/PlayButton.svelte';

	let {
		readings,
		audioFor,
		lang = '',
		deviceVoice = false,
		word = '',
		language = ''
	}: {
		readings: Reading[];
		/**
		 * Syllable clips of a pinyin reading, aligned with the readings the API
		 * resolved; null when it has none. Without it no play button shows.
		 */
		audioFor?: (reading: Reading, index: number) => AudioClip[] | null;
		lang?: string;
		deviceVoice?: boolean;
		/** The headword, for the play buttons' accessible names. */
		word?: string;
		/** The entry's language: the readings' `lang` (lib/i18n/lang.ts). */
		language?: string;
	} = $props();

	// The API orders readings, but ord is the contract: sort a copy so a
	// badly ordered pack still displays predictably.
	const ordered = $derived([...readings].sort((a, b) => a.ord - b.ord));
	// The spoken romanisation carries the reading accent; the phonetic
	// scripts (zhuyin, kana, on/kun) stay muted.
	const isRomanised = (type: string): boolean =>
		type === 'pinyin' || type === 'romaji' || type === 'bopomofo';
</script>

{#if ordered.length > 0}
	<!-- No section heading: the readings sit in the entry's header (#104). -->
	<ul class="readings" aria-label={t('entry.readings.title')}>
		{#each ordered as reading, index (`${reading.type}:${reading.ord}:${index}`)}
			<li data-type={reading.type}>
				<span class:romanised={isRomanised(reading.type)}>
					<ReadingText type={reading.type} value={reading.value} language={studyLang(language) ?? ''} />
				</span>
				{#if audioFor && reading.type === 'pinyin'}
					<PlayButton
						clips={audioFor(reading, index) ?? []}
						{lang}
						{deviceVoice}
						label={word ? `${word} (${reading.value})` : reading.value}
					/>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.readings {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.readings li {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 1.0625rem;
		color: var(--readable-muted);
	}

	.readings .romanised {
		color: var(--reading-accent);
		font-weight: var(--weight-medium);
	}
</style>
