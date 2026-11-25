<script lang="ts">
	// Character anatomy (#212): the parts a character is built from, each with its meaning. The parts come from
	// the installed components packs (#71) and the meanings from the dictionary's characters, so nothing new is
	// bundled; a language or character without parts shows nothing. The meaning is text beside each part, never
	// only a colour. Opt out: Settings > Study > Visual aids.
	import { fetchCharacters } from '$lib/api/characters';
	import { fetchComponents } from '$lib/api/components';
	import { existingApp } from '$lib/context/context';
	import { t } from '$lib/i18n';
	import { glossLang, studyLang } from '$lib/i18n/lang';
	import { loadAnatomy, type AnatomyPart } from './anatomy';
	import { useVisualAids } from './useAids';

	let {
		char,
		language,
		radical = '',
		heading = 2
	}: {
		/** One character. */
		char: string;
		language: string;
		/** The character's radical when known, to mark it. */
		radical?: string;
		/** Heading level of the title; null draws it as a label (inside a card). */
		heading?: 2 | 3 | null;
	} = $props();

	const app = existingApp();
	const view = useVisualAids();
	let parts = $state<AnatomyPart[]>([]);
	const uid = $props.id();

	$effect(() => {
		const session = app?.session;
		const c = char;
		const lang = language;
		const rad = radical;
		if (!view.aids.anatomy || !session) {
			parts = [];
			return;
		}
		let live = true;
		void loadAnatomy(
			c,
			{
				components: () => fetchComponents(session.caches.components, lang),
				universe: async () => (await fetchCharacters(session.caches.characters, lang)).chars
			},
			rad || undefined
		).then((list) => {
			if (live) parts = list;
		});
		return () => {
			live = false;
		};
	});
</script>

{#if parts.length > 0}
	<section class="anatomy" aria-labelledby="{uid}-t" data-testid="anatomy">
		{#if heading === null}<p id="{uid}-t" class="title">{t('study.aids.anatomy.title')}</p>
		{:else}<svelte:element this={`h${heading}`} id="{uid}-t" class="title">{t('study.aids.anatomy.title')}</svelte:element>{/if}
		<ul class="parts">
			{#each parts as part (part.glyph)}
				<li data-part={part.glyph}>
					<span class="glyph" lang={studyLang(language)}>{part.glyph}</span>
					{#if part.meaning}<span class="meaning" lang={glossLang(undefined)}>{part.meaning}</span>{/if}
					{#if part.isRadical}<small class="radical">{t('study.aids.anatomy.radical')}</small>{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.anatomy {
		display: grid;
		gap: var(--space-1);
	}
	.title {
		margin: 0;
		font-size: var(--font-size-label);
		font-weight: var(--weight-strong);
		color: var(--readable-muted);
	}
	.parts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-1);
		padding: 0 var(--space-2);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
	}
	.glyph {
		font-family: var(--font-hanzi);
		font-size: 1.5rem;
	}
	.meaning {
		font-size: var(--font-size-s);
	}
	.radical {
		color: var(--readable-muted);
	}
</style>
