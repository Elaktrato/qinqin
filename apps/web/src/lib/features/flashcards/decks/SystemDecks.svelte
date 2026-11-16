<script lang="ts">
	import { getSchemes } from '$lib/api/schemes';
	import { errorMessage } from '$lib/stats/errors';
	import { flashcardsHref } from '../route';
	import { loadLevelItems } from './systemDeckItems';
	import { levelDecks, type LevelDeck } from './systemDecks';

	// Level decks of the installed level packs, grouped by scheme and
	// collapsed. Nothing here is stored or editable: a level's items are
	// loaded when its scheme is expanded, to show how many are already yours.
	let { language, ownedEntryIds }: { language: string; ownedEntryIds: ReadonlySet<number> } = $props();

	let decks = $state.raw<LevelDeck[] | null>(null);
	let loadError = $state('');
	let expanded = $state<number[]>([]);
	// Per level: the item entry ids, or a failure.
	let items = $state.raw<Record<string, number[] | 'error' | undefined>>({});

	const groups = $derived.by(() => {
		const out: { schemeId: number; name: string; packId: string; levels: LevelDeck[] }[] = [];
		for (const deck of decks ?? []) {
			let group = out.find((g) => g.schemeId === deck.schemeId);
			if (group === undefined) {
				group = { schemeId: deck.schemeId, name: deck.schemeName, packId: deck.packId, levels: [] };
				out.push(group);
			}
			group.levels.push(deck);
		}
		return out;
	});

	$effect(() => {
		const wanted = language;
		decks = null;
		loadError = '';
		getSchemes().then(
			(schemes) => {
				if (wanted === language) decks = levelDecks(schemes, wanted);
			},
			(err) => {
				loadError = errorMessage(err, 'Could not load the level decks.');
			}
		);
	});

	function keyOf(deck: LevelDeck): string {
		return `${deck.schemeId}\u0000${deck.level}`;
	}

	function loadLevel(deck: LevelDeck): void {
		const key = keyOf(deck);
		const current = items[key];
		if (Array.isArray(current)) return;
		loadLevelItems(deck).then(
			(list) => (items = { ...items, [key]: list.map((e) => e.id) }),
			() => (items = { ...items, [key]: 'error' })
		);
	}

	function toggle(group: { schemeId: number; levels: LevelDeck[] }): void {
		if (expanded.includes(group.schemeId)) {
			expanded = expanded.filter((id) => id !== group.schemeId);
			return;
		}
		expanded = [...expanded, group.schemeId];
		for (const deck of group.levels) loadLevel(deck);
	}

	function ownedOf(list: number[]): number {
		return list.filter((id) => ownedEntryIds.has(id)).length;
	}
</script>

<section aria-labelledby="system-decks-heading">
	<h2 id="system-decks-heading">Level and plugin decks</h2>
	<p class="hint">Read-only decks from installed level packs. Copy one into a deck of your own to study it.</p>
	{#if loadError}
		<p role="alert">{loadError}</p>
	{:else if decks === null}
		<p role="status">Loading level decks…</p>
	{:else if groups.length === 0}
		<p class="hint">No level decks are installed for this language.</p>
	{:else}
		<ul class="groups">
			{#each groups as group (group.schemeId)}
				<li>
					<button
						type="button"
						class="toggle"
						aria-expanded={expanded.includes(group.schemeId)}
						onclick={() => toggle(group)}
					>
						<span aria-hidden="true">{expanded.includes(group.schemeId) ? '▾' : '▸'}</span>
						{group.name}
						<span class="count">({group.levels.length} {group.levels.length === 1 ? 'level' : 'levels'})</span>
					</button>
					{#if expanded.includes(group.schemeId)}
						<ul class="levels">
							{#each group.levels as deck (deck.level)}
								{@const loaded = items[keyOf(deck)]}
								<li>
									<a href={flashcardsHref({ view: 'system-level', packId: deck.packId, level: deck.level })}
										>{deck.level}</a
									>
									<span class="owned">
										{#if loaded === 'error'}
											Could not load
										{:else if loaded === undefined}
											Loading…
										{:else}
											{ownedOf(loaded)} of {loaded.length} in your decks
										{/if}
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.groups,
	.levels {
		list-style: none;
		margin: 0.25rem 0;
		padding: 0;
	}

	.levels {
		padding-left: 1.5rem;
	}

	.toggle {
		min-height: 44px;
		width: 100%;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		text-align: left;
		border: 0;
		background: transparent;
		font-weight: 600;
	}

	.count,
	.owned,
	.hint {
		font-weight: 400;
		opacity: 0.8;
	}

	.levels li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		align-items: baseline;
		min-height: 44px;
	}
</style>
