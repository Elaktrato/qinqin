<script lang="ts">
	import { t } from '$lib/i18n';
	import { glossLang, readingLang, studyLang } from '$lib/i18n/lang';
	import type { Sentence } from '$lib/api/types';
	import { markTerm } from '$lib/entry/markTerm';

	let {
		sentences,
		language = '',
		term = ''
	}: {
		sentences: Sentence[];
		/** The entry's language. */
		language?: string;
		/** The entry's word, set in the reading accent inside each example. */
		term?: string;
	} = $props();

	const parts = (hanzi: string) => markTerm(hanzi, term);

	// Pack sentences carry their source pack; user sentences have no
	// pack, so they are labelled with the user that wrote them.
	function origin(sentence: Sentence): string {
		if (sentence.userId !== null) {
			return sentence.sourcePack
				? t('entry.sentences.packUser', { pack: sentence.sourcePack, id: `#${sentence.userId}` })
				: t('entry.sentences.user', { id: `#${sentence.userId}` });
		}
		return sentence.sourcePack || t('entry.sentences.shared');
	}
</script>

{#if sentences.length > 0}
	<section class="sentences" aria-labelledby="sentences-heading">
		<h2 id="sentences-heading">{t('entry.page.examples')}</h2>
		<ul>
			{#each sentences as sentence (sentence.id)}
				<li class="sentence">
					<p class="hanzi" lang={studyLang(language)}
						>{#each parts(sentence.hanzi) as part, index (index)}{#if part.match}<b class="term">{part.text}</b
								>{:else}{part.text}{/if}{/each}</p
					>
					{#if sentence.pinyin}<p class="pinyin" lang={readingLang('pinyin', language)}>{sentence.pinyin}</p>{/if}
					{#if sentence.translation}<p class="translation" lang={glossLang(undefined)}>{sentence.translation}</p>{/if}
					<span class="origin">{origin(sentence)}</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.sentences {
		display: grid;
		gap: var(--space-2);
	}

	.sentences h2,
	.sentences ul {
		margin: 0;
	}

	.sentences h2 {
		font-size: var(--font-size-label);
		font-weight: var(--weight-medium);
		color: var(--readable-muted);
	}

	.sentences ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: var(--space-3);
	}

	.sentence {
		display: grid;
		gap: var(--space-1);
	}

	.sentence p {
		margin: 0;
	}

	.hanzi {
		font-size: 1.125rem;
	}

	.term {
		font-weight: var(--weight-strong);
		color: var(--reading-accent);
	}

	.pinyin {
		font-size: 0.9rem;
		color: var(--readable-muted);
	}

	.translation {
		font-size: 0.95rem;
		color: var(--readable-muted);
	}

	.origin {
		display: inline-block;
		font-size: 0.7rem;
		color: var(--readable-muted);
	}
</style>
