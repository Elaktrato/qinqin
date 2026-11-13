<script lang="ts">
	import type { LookupResult } from '$lib/api/types';
	import AddToStudyButtons from './AddToStudyButtons.svelte';
	import {
		dictionaryNames,
		frequencyLabel,
		hasCjk,
		joinForms,
		moreLabel,
		otherForms,
		parseXref,
		readingLine,
		rubyReading,
		senseChips,
		shownSenses
	} from './entryDisplay';
	import { SENSES_VISIBLE, visibleCount } from './showMore';

	// One dictionary entry of a lookup popup. Text that Shift+hover can look
	// up (cross-reference headwords, glosses with Han or kana) is marked
	// data-scan with the lookup language `lang`; plain English glosses, xref
	// readings and sense numbers are not. `textLang` is the lang attribute
	// of CJK text (zh-Hans/zh-Hant pick glyphs, as in the reader text).
	// `study` shows the add-to-study buttons (absent: no workspace to add to).
	let {
		result,
		lang,
		textLang,
		study
	}: {
		result: LookupResult;
		lang: string;
		textLang: string;
		study?: { workspaceId: number; paragraph: string | null; hold: (on: boolean) => void };
	} = $props();

	const ruby = $derived(rubyReading(result, lang));
	const reading = $derived(readingLine(result, lang));
	const forms = $derived(otherForms(result));
	const sources = $derived(dictionaryNames(result));
	const senses = $derived(shownSenses(result));
	let shown = $state(SENSES_VISIBLE);
	const visible = $derived(visibleCount(senses.length, 0, shown));
	const hidden = $derived(senses.length - visible);
</script>

<article class="entry">
	<header>
		<span class="term" lang={textLang}>
			{#if ruby}<ruby>{result.term}<rt>{ruby}</rt></ruby>{:else}{result.term}{/if}
		</span>
		{#if reading}<span class="reading" lang={textLang}>{reading}</span>{/if}
		{#if forms.length > 0}<span class="forms" lang={textLang}>{joinForms(forms, lang)}</span>{/if}
		{#if study}
			<AddToStudyButtons
				{result}
				workspaceId={study.workspaceId}
				paragraph={study.paragraph}
				hold={study.hold}
			/>
		{/if}
	</header>

	{#if result.reasons.length > 0 || result.tags.length > 0 || result.frequencies.length > 0}
		<ul class="chips">
			{#if result.reasons.length > 0}
				<li class="chip inflection" title="Inflection">{result.reasons.join(' → ')}</li>
			{/if}
			{#each result.tags as tag, i (i)}
				<li class="chip">{tag}</li>
			{/each}
			{#each result.frequencies as f (f.packId)}
				<li class="chip frequency" title="Frequency rank ({f.packName})">
					<span class="pack">{f.packName}</span>
					{frequencyLabel(f)}
				</li>
			{/each}
		</ul>
	{/if}

	{#if sources.length > 0 || result.matched !== result.term}
		<p class="source">
			{sources.join(', ')}{#if result.matched !== result.term}{#if sources.length > 0}&ensp;·&ensp;{/if}matched
				<span lang={textLang}>{result.matched}</span>{/if}
		</p>
	{/if}

	{#if senses.length > 0}
		<ol class="senses">
			{#each senses.slice(0, visible) as sense, i (i)}
				<li>
					{#each senseChips(sense) as chip, c (c)}<span class="chip pos">{chip}</span>{/each}
					<!-- Separators are expressions: Svelte trims literal whitespace at block edges. -->
					{#each sense.glosses as gloss, g (g)}
						{#if g > 0}{'; '}{/if}
						{#if hasCjk(gloss)}<span class="scan" data-scan={lang} lang={textLang}>{gloss}</span>{:else}{gloss}{/if}
					{/each}
					{#if sense.xrefs.length > 0}
						<span class="xrefs">
							{'see also '}
							<!-- One line: whitespace between these nodes would show before the commas. -->
							{#each sense.xrefs.map(parseXref) as xref, x (x)}{#if x > 0}{', '}{/if}<span
									class="scan"
									data-scan={lang}
									lang={textLang}>{xref.headword}</span
								>{#if xref.reading}{' '}<span lang={textLang}>{`(${xref.reading})`}</span>{/if}{#if xref.senseNo}{` sense ${xref.senseNo}`}{/if}{/each}
						</span>
					{/if}
				</li>
			{/each}
		</ol>
		{#if hidden > 0}
			<button type="button" class="more" onclick={() => (shown = visibleCount(senses.length, shown))}>
				{moreLabel(hidden, 'sense', 'senses')}
			</button>
		{/if}
	{/if}
	<p class="open"><a href={`/entry/${Number(result.entryId)}`}>Open full entry</a></p>
</article>

<style>
	.entry + :global(.entry) {
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
	}

	header {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.2rem 0.6rem;
	}

	.term {
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.6;
	}

	rt {
		font-size: 0.5em;
		font-weight: 400;
	}

	.reading {
		font-size: 1.05rem;
	}

	.forms,
	.source {
		opacity: 0.75;
	}

	.chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin: 0.2rem 0 0;
		padding: 0;
	}

	.chip {
		display: inline-block;
		padding: 0 0.4rem;
		border-radius: 0.6rem;
		font-size: 0.75rem;
		line-height: 1.5;
		background: color-mix(in srgb, currentColor 10%, transparent);
	}

	.inflection {
		background: color-mix(in srgb, #8a4fd1 22%, transparent);
	}

	.frequency {
		background: color-mix(in srgb, #1b8a5a 22%, transparent);
	}

	.pack {
		opacity: 0.75;
		margin-right: 0.2rem;
	}

	.pos {
		margin-right: 0.25rem;
		background: color-mix(in srgb, #0b6bcb 18%, transparent);
	}

	.source {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
	}

	.senses {
		margin: 0.3rem 0 0;
		padding-left: 1.4rem;
		display: grid;
		gap: 0.2rem;
	}

	.xrefs {
		opacity: 0.8;
		font-style: italic;
	}

	/* Shift+hover looks these up: a faint dotted underline shows where. */
	.scan {
		text-decoration: underline dotted color-mix(in srgb, currentColor 45%, transparent);
		text-underline-offset: 0.2em;
	}

	.more {
		margin-top: 0.25rem;
		padding: 0;
		border: none;
		background: none;
		color: LinkText;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
		text-decoration: underline;
	}

	.open {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
	}
</style>
