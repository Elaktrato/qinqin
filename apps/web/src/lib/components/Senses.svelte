<script lang="ts">
	import type { SenseView } from '$lib/api/types';
	import { tick } from 'svelte';
	import { hiddenDictionaries, partitionSenses } from '$lib/dictionaryVisibility';
	import { workspaces } from '$lib/workspaces';

	let { senses }: { senses: SenseView[] } = $props();

	// Dictionaries the current workspace hides collapse behind a button.
	const partition = $derived(
		partitionSenses(senses, hiddenDictionaries($workspaces.current))
	);
	let revealed = $state(false);
	let heading = $state<HTMLHeadingElement | null>(null);

	// The button vanishes once pressed: keep keyboard focus in the section.
	async function reveal(): Promise<void> {
		revealed = true;
		await tick();
		heading?.focus();
	}
	const visibleSenses = $derived(revealed ? senses : partition.shown);

	interface SenseGroup {
		dictionaryId: number;
		dictionaryName: string;
		license: string;
		attribution: string;
		glosses: string[];
	}

	// Group by dictionary in first-seen order: the API's stable order is
	// preserved rather than resorted by name or id.
	const groups = $derived.by((): SenseGroup[] => {
		const byDictionary = new Map<number, SenseGroup>();
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
			group.glosses.push(sense.gloss);
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
	<section class="senses" aria-labelledby="senses-heading">
		<h2 id="senses-heading" bind:this={heading} tabindex="-1">Senses</h2>
		{#each groups as group (group.dictionaryId)}
			<article class="dictionary">
				<h3>{group.dictionaryName}</h3>
				<ol class="glosses">
					{#each group.glosses as gloss, index (index)}
						<li>{gloss}</li>
					{/each}
				</ol>
				{#if group.license || group.attribution}
					<p class="source">
						{#if group.license}<span class="license">{group.license}</span>{/if}
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
			<p class="hidden-note">Shown although its dictionaries are hidden in this workspace</p>
		{:else if !revealed && partition.hidden.length > 0}
			<button type="button" class="reveal" onclick={reveal}>
				Show {partition.hidden.length} from hidden dictionaries
			</button>
		{/if}
	</section>
{/if}

<style>
	.senses {
		margin-top: 2rem;
	}

	.senses h2,
	.senses h3 {
		margin: 0;
	}

	.senses h2 {
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.dictionary + .dictionary {
		margin-top: 1rem;
	}

	.dictionary h3 {
		font-size: 1rem;
		margin-top: 0.75rem;
	}

	.glosses {
		margin: 0.4rem 0 0;
		padding-left: 1.4rem;
		display: grid;
		gap: 0.25rem;
	}

	.source {
		margin: 0.35rem 0 0;
		font-size: 0.75rem;
		opacity: 0.7;
	}

	.separator {
		margin: 0 0.25rem;
	}

	.hidden-note {
		margin: 0.75rem 0 0;
		font-size: 0.8rem;
		opacity: 0.7;
	}

	.reveal {
		min-height: 44px;
		margin-top: 0.5rem;
		padding: 0;
		border: none;
		background: none;
		color: LinkText;
		font: inherit;
		font-size: 0.85rem;
		text-decoration: underline;
		cursor: pointer;
	}

	.source a {
		color: inherit;
	}
</style>
