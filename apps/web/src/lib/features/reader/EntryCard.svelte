<script lang="ts">
	import { t } from '$lib/i18n';
	import { tick } from 'svelte';
	import type { LookupResult } from '$lib/api/types';
	import { partitionSenses } from '$lib/dictionaryVisibility';
	import AddToStudyButtons from './AddToStudyButtons.svelte';
	import { Chip } from '$lib/ui';
	import {
		dictionaryNames,
		frequencyLabel,
		hasCjk,
		joinForms,
		levelChips,
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
		study,
		hidden = new Set<number>(),
		first = false
	}: {
		result: LookupResult;
		lang: string;
		textLang: string;
		study?: {
			workspaceId: number;
			paragraph: string | null;
			hold: (on: boolean) => void;
			/** The word-state line of an entry (word highlighting on), else absent. */
			stateLine?: ((entryId: number) => string) | null;
		};
		/** Ids of dictionaries the workspace hides; their senses sit behind a button. */
		hidden?: ReadonlySet<number>;
		/** The first result of the root popup (the lookup history's hint). */
		first?: boolean;
	} = $props();

	const ruby = $derived(rubyReading(result, lang));
	const reading = $derived(readingLine(result, lang));
	const forms = $derived(otherForms(result));
	const sources = $derived(dictionaryNames(result));
	const levels = $derived(levelChips(result));
	const allSenses = $derived(shownSenses(result));
	const partition = $derived(partitionSenses(allSenses, hidden));
	let revealed = $state(false);
	let sensesList = $state<HTMLOListElement | null>(null);

	// The button vanishes once pressed: keep keyboard focus on the list.
	async function reveal(): Promise<void> {
		revealed = true;
		await tick();
		sensesList?.focus();
	}
	const senses = $derived(revealed ? allSenses : partition.shown);
	let shown = $state(SENSES_VISIBLE);
	const visible = $derived(visibleCount(senses.length, 0, shown));
	const more = $derived(senses.length - visible);
</script>

<!-- One entry (design §9 "Reader"): term, reading, chips (levels first,
     then frequency and tags), numbered glosses, the source line, actions.
     Entries are separated by hairlines, never boxed. -->
<article class="entry">
	<header>
		<span class="term" lang={textLang}>
			{#if ruby}<ruby>{result.term}<rt>{ruby}</rt></ruby>{:else}{result.term}{/if}
		</span>
		{#if reading}<span class="reading accent" lang={textLang}>{reading}</span>{/if}
		{#if forms.length > 0}<span class="forms" lang={textLang}>{joinForms(forms, lang)}</span>{/if}
	</header>

	{#if levels.length > 0 || result.reasons.length > 0 || result.tags.length > 0 || result.frequencies.length > 0}
		<ul class="chips">
			{#each levels as level, i (i)}
				<li class="level"><Chip>{level}</Chip></li>
			{/each}
			{#each result.frequencies as f (f.packId)}
				<li class="frequency" title={t('reader.entry.frequency', { pack: f.packName })}>
					<Chip><span class="pack">{f.packName}</span> {frequencyLabel(f)}</Chip>
				</li>
			{/each}
			{#if result.reasons.length > 0}
				<li class="inflection" title={t('reader.entry.inflection')}><Chip>{result.reasons.join(' → ')}</Chip></li>
			{/if}
			{#each result.tags as tag, i (i)}
				<li><Chip>{tag}</Chip></li>
			{/each}
		</ul>
	{/if}

	{#if senses.length > 0}
		<ol class="senses" bind:this={sensesList} tabindex="-1">
			{#each senses.slice(0, visible) as sense, i (i)}
				<li>
					{#each senseChips(sense) as chip, c (c)}<span class="pos">{chip}</span>{/each}
					<!-- Separators are expressions: Svelte trims literal whitespace at block edges. -->
					{#each sense.glosses as gloss, g (g)}
						{#if g > 0}{'; '}{/if}
						{#if hasCjk(gloss)}<span class="scan" data-scan={lang} lang={textLang}>{gloss}</span>{:else}{gloss}{/if}
					{/each}
					{#if sense.xrefs.length > 0}
						<span class="xrefs">
							{`${t('reader.entry.seeAlso')} `}
							<!-- One line: whitespace between these nodes would show before the commas. -->
							{#each sense.xrefs.map(parseXref) as xref, x (x)}{#if x > 0}{', '}{/if}<span
									class="scan"
									data-scan={lang}
									lang={textLang}>{xref.headword}</span
								>{#if xref.reading}{' '}<span lang={textLang}>{`(${xref.reading})`}</span>{/if}{#if xref.senseNo}{` ${t('reader.entry.senseNo', { n: xref.senseNo })}`}{/if}{/each}
						</span>
					{/if}
				</li>
			{/each}
		</ol>
		{#if more > 0}
			<button type="button" class="more" onclick={() => (shown = visibleCount(senses.length, shown))}>
				{moreLabel(more, 'sense')}
			</button>
		{/if}
		{#if partition.allHidden}
			<p class="hidden-note">{t('reader.entry.allHidden')}</p>
		{:else if !revealed && partition.hidden.length > 0}
			<button type="button" class="more reveal" onclick={reveal}>
				{t('reader.entry.showHidden', { count: partition.hidden.length })}
			</button>
		{/if}
	{/if}
	{#if sources.length > 0 || result.matched !== result.term}
		<p class="source">
			{sources.join(', ')}{#if result.matched !== result.term}{#if sources.length > 0}&ensp;·&ensp;{/if}{t('reader.entry.matched')}
				<span lang={textLang}>{result.matched}</span>{/if}
		</p>
	{/if}
	{#if study}
		<AddToStudyButtons
			{result}
			workspaceId={study.workspaceId}
			paragraph={study.paragraph}
			hold={study.hold}
			stateLine={study.stateLine ? study.stateLine(result.entryId) : null}
			{first}
		/>
	{/if}
	<p class="open"><a href={`/entry/${Number(result.entryId)}`}>{t('reader.entry.open')}</a></p>
</article>

<style>
	.entry {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) 0;
	}

	.entry + :global(.entry) {
		border-top: 1px solid var(--hair);
	}

	header {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
	}

	.term {
		font-family: var(--font-hanzi);
		font-size: var(--font-size-xl);
		font-weight: var(--weight-regular);
		line-height: 1.5;
	}

	rt {
		font-size: 0.5em;
		font-weight: var(--weight-regular);
	}

	/* The reading in the readable accent (design §9). */
	.reading.accent {
		color: var(--reading-accent);
		font-weight: var(--weight-medium);
	}

	.forms,
	.source {
		color: var(--readable-muted);
	}

	.chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
	}

	.pack {
		color: var(--readable-muted);
	}

	.pos {
		margin-inline-end: var(--space-1);
		color: var(--readable-muted);
		font-size: var(--font-size-xs);
	}

	.source {
		margin: 0;
		font-size: var(--font-size-xs);
	}

	.senses {
		margin: 0;
		padding-inline-start: 1.2em;
		display: grid;
		gap: 2px;
		font-size: var(--font-size-s);
	}

	.xrefs {
		color: var(--readable-muted);
		font-style: italic;
	}

	/* Shift+hover looks these up: a faint dotted underline shows where. */
	.scan {
		text-decoration: underline dotted var(--line);
		text-underline-offset: 0.2em;
	}

	.more {
		justify-self: start;
		padding: 0;
		border: none;
		background: none;
		color: var(--reading-accent);
		font: inherit;
		font-size: var(--font-size-xs);
		cursor: pointer;
		text-decoration: underline;
	}

	.hidden-note {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--readable-muted);
	}

	.reveal {
		display: block;
		min-height: var(--hit);
	}

	.open {
		margin: 0;
		font-size: var(--font-size-xs);
	}
</style>
