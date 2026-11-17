<script lang="ts">
	import ReadingText from './ReadingText.svelte';
	import { studyLang } from '$lib/i18n/lang';
	import type { Reading } from '$lib/api/types';
	import type { AudioClip } from '$lib/api/audio';
	import { formatReading } from '$lib/format';
	import { t } from '$lib/i18n';
	import PlayButton from './PlayButton.svelte';

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
</script>

{#if ordered.length > 0}
	<section class="readings" aria-labelledby="readings-heading">
		<h2 id="readings-heading">{t('entry.readings.title')}</h2>
		<ul>
			{#each ordered as reading, index (`${reading.type}:${reading.ord}:${index}`)}
				<li data-type={reading.type}>
					<ReadingText type={reading.type} value={reading.value} language={studyLang(language) ?? ''} />
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
	</section>
{/if}

<style>
	.readings h2,
	.readings ul {
		margin: 0;
	}

	.readings {
		margin-top: 2rem;
	}

	.readings h2 {
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--readable-muted);
	}

	.readings ul {
		list-style: none;
		padding: 0;
		margin-top: 0.5rem;
		display: grid;
		gap: 0.3rem;
	}

	.readings li {
		font-size: 1.05rem;
	}
</style>
