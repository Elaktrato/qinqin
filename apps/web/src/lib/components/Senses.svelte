<script lang="ts">
	import { glossLang } from '$lib/i18n/lang';
	import type { SenseGroup, SenseView } from '$lib/api/types';
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { hiddenDictionaries, partitionSenses } from '$lib/dictionaryVisibility';
	import { licenseUrl } from '$lib/licenses';
	import { useSession } from '$lib/context/context';
	const session = useSession();
	let {
		senses,
		senseGroups = []
	}: {
		senses: SenseView[];
		/** The same senses with their part of speech (and xrefs), for POS. */
		senseGroups?: SenseGroup[];
	} = $props();

	// Dictionaries the current workspace hides collapse behind a button.
	const partition = $derived(
		partitionSenses(senses, hiddenDictionaries(session.workspaces.current))
	);
	let revealed = $state(false);
	let section = $state<HTMLElement | null>(null);

	// The button vanishes once pressed: keep keyboard focus in the section.
	async function reveal(): Promise<void> {
		revealed = true;
		await tick();
		section?.querySelector<HTMLElement>('h2')?.focus();
	}
	const visibleSenses = $derived(revealed ? senses : partition.shown);

	interface GlossRow {
		text: string;
		pos: string[];
	}

	interface SenseGroupView {
		dictionaryId: number;
		dictionaryName: string;
		license: string;
		attribution: string;
		glosses: GlossRow[];
	}

	// The part of speech per dictionary and gloss (one gloss can repeat in
	// two senses; the first sense's POS wins).
	const posByGloss = $derived.by((): Map<string, string[]> => {
		const map = new Map<string, string[]>();
		for (const group of senseGroups) {
			for (const gloss of group.glosses) {
				const key = `${group.dictionaryId}\u0000${gloss}`;
				if (!map.has(key)) map.set(key, group.pos);
			}
		}
		return map;
	});

	// Group by dictionary in first-seen order: the API's stable order is
	// preserved rather than resorted by name or id.
	const groups = $derived.by((): SenseGroupView[] => {
		const byDictionary = new Map<number, SenseGroupView>();
		for (const sense of visibleSenses) {
			let group = byDictionary.get(sense.dictionaryId);
			if (!group) {
				group = {
					dictionaryId: sense.dictionaryId,
					dictionaryName: sense.dictionaryName,
					license: sense.license,
					attribution: sense.attribution,
					glosses: []
				};
				byDictionary.set(sense.dictionaryId, group);
			}
			group.glosses.push({
				text: sense.gloss,
				pos: posByGloss.get(`${sense.dictionaryId}\u0000${sense.gloss}`) ?? []
			});
		}
		return [...byDictionary.values()];
	});

	interface AttributionPart {
		text: string;
		href: string | null;
	}

	// Attributions commonly carry a URL in parentheses; make it a link
	// while keeping the surrounding credit text intact.
	function attributionParts(text: string): AttributionPart[] {
		return text
			.split(/(https?:\/\/[^\s)]+)/)
			.filter((part) => part !== '')
			.map((part) => (/^https?:\/\//.test(part) ? { text: part, href: part } : { text: part, href: null }));
	}
</script>

{#if groups.length > 0}
	<section class="senses" bind:this={section} aria-label={t('entry.senses.title')}>
		{#each groups as group (group.dictionaryId)}
			<article class="dictionary" aria-labelledby={`meanings-${group.dictionaryId}`}>
				<h2 id={`meanings-${group.dictionaryId}`} tabindex="-1">{t('entry.page.meaningsFrom', { dictionary: group.dictionaryName })}</h2>
				<ol class="glosses">
					{#each group.glosses as gloss, index (index)}
						<li lang={glossLang(undefined)}>
							{#if gloss.pos.length > 0}<span class="pos">{gloss.pos.join(', ')}</span>{/if}{gloss.text}
						</li>
					{/each}
				</ol>
				{#if group.license || group.attribution}
					<p class="source">
						{#if group.license}
							{@const href = licenseUrl(group.license)}
							<span class="license"
								>{#if href}<a {href} target="_blank" rel="noopener noreferrer">{group.license}</a
									>{:else}{group.license}{/if}</span
							>
						{/if}
						{#if group.license && group.attribution}<span class="separator">·</span>{/if}
						{#each attributionParts(group.attribution) as part, index (index)}
							{#if part.href}
								<a href={part.href} target="_blank" rel="noreferrer">{part.text}</a>
							{:else}
								{part.text}
							{/if}
						{/each}
					</p>
				{/if}
			</article>
		{/each}
		{#if partition.allHidden}
			<p class="hidden-note">{t('entry.senses.hiddenShown')}</p>
		{:else if !revealed && partition.hidden.length > 0}
			<button type="button" class="reveal" onclick={reveal}>
				{t('entry.senses.showHidden', { count: partition.hidden.length })}
			</button>
		{/if}
	</section>
{/if}

<style>
	.senses {
		display: grid;
		gap: var(--space-4);
	}

	.dictionary h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-label);
		font-weight: var(--weight-medium);
		color: var(--readable-muted);
	}

	.dictionary h2:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.glosses {
		margin: 0;
		padding-inline-start: 1.4em;
		display: grid;
		gap: var(--space-1);
	}

	.pos {
		margin-inline-end: var(--space-2);
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.source {
		margin: var(--space-2) 0 0;
		font-size: 0.75rem;
		color: var(--readable-muted);
	}

	.separator {
		margin: 0 0.25rem;
	}

	.hidden-note {
		margin: 0;
		font-size: 0.8rem;
		color: var(--readable-muted);
	}

	.reveal {
		min-height: 44px;
		margin-top: 0.5rem;
		padding: 0;
		border: none;
		background: none;
		color: var(--reading-accent);
		font: inherit;
		font-size: 0.85rem;
		text-decoration: underline;
		cursor: pointer;
	}

	.source a {
		color: inherit;
	}
</style>
