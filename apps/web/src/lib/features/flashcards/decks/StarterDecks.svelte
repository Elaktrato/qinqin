<script lang="ts">
	import { t } from '$lib/i18n';
	import { getFrequencyPacks } from '$lib/api/frequency';
	import { errorMessage } from '$lib/stats/errors';
	import { noPackHint } from '$lib/study/newOrderView';
	import { flashcardsHref } from '../route';
	import { Button, Section } from '$lib/ui';
	import { loadStarterEntries, starterCredit, starterDecks, starterTitle, type StarterDeck } from './starterDecks';

	// Starter decks (#75): Top 500/1000/2000 of each installed frequency pack
	// of the workspace language, computed by the server, collapsed per pack.
	// Expanding loads the Top 2000 once; the smaller decks are its prefix.
	let { language, ownedEntryIds }: { language: string; ownedEntryIds: ReadonlySet<number> } = $props();

	let decks = $state.raw<StarterDeck[] | null>(null);
	let loadError = $state('');
	let expanded = $state<number[]>([]);
	let items = $state.raw<Record<number, number[] | 'error' | undefined>>({});

	const groups = $derived.by(() => {
		const out: { packNumId: number; name: string; credit: string; decks: StarterDeck[] }[] = [];
		for (const deck of decks ?? []) {
			let group = out.find((g) => g.packNumId === deck.packNumId);
			if (group === undefined) {
				group = { packNumId: deck.packNumId, name: deck.packName, credit: starterCredit(deck), decks: [] };
				out.push(group);
			}
			group.decks.push(deck);
		}
		return out;
	});

	$effect(() => {
		const wanted = language;
		decks = null;
		loadError = '';
		getFrequencyPacks().then(
			(packs) => {
				if (wanted === language) decks = starterDecks(Array.isArray(packs) ? packs : [], wanted);
			},
			(err) => {
				// Starter decks are an extra: a failed list is a quiet line, never an alert.
				loadError = errorMessage(err, t('flashcards.starter.loadFailed'));
			}
		);
	});

	function toggle(group: { packNumId: number }): void {
		if (expanded.includes(group.packNumId)) {
			expanded = expanded.filter((id) => id !== group.packNumId);
			return;
		}
		expanded = [...expanded, group.packNumId];
		if (Array.isArray(items[group.packNumId])) return;
		loadStarterEntries(group.packNumId, 2000).then(
			(list) => (items = { ...items, [group.packNumId]: list.map((e) => e.id) }),
			() => (items = { ...items, [group.packNumId]: 'error' })
		);
	}

	function ownedOf(list: number[], size: number): string {
		const part = list.slice(0, size);
		return t('flashcards.system.owned', { owned: part.filter((id) => ownedEntryIds.has(id)).length, total: part.length });
	}
</script>

<Section title={t('flashcards.starter.title')}>
	<p class="hint">{t('flashcards.starter.listIntro')}</p>
	{#if loadError}
		<p class="hint">{loadError}</p>
	{:else if decks === null}
		<p role="status">{t('flashcards.starter.loading')}</p>
	{:else if groups.length === 0}
		<p class="hint">{noPackHint(language)}</p>
	{:else}
		<ul class="groups">
			{#each groups as group (group.packNumId)}
				{@const loaded = items[group.packNumId]}
				<li>
					<Button
						variant="secondary"
						class="toggle"
						icon={expanded.includes(group.packNumId) ? 'expand-down' : 'forward'}
						aria-expanded={expanded.includes(group.packNumId)}
						onclick={() => toggle(group)}
					>
						{t('flashcards.starter.group', { name: group.name })}
					</Button>
					<p class="credit">{group.credit}</p>
					{#if expanded.includes(group.packNumId)}
						<ul class="levels">
							{#each group.decks as deck (deck.size)}
								<li>
									<a href={flashcardsHref({ view: 'system-frequency', packId: deck.packId, size: deck.size })}
										>{starterTitle(deck)}</a
									>
									<span class="owned">
										{#if loaded === 'error'}
											{t('flashcards.system.couldNotLoad')}
										{:else if loaded === undefined}
											{t('common.loading')}
										{:else}
											{ownedOf(loaded, deck.size)}
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
</Section>

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


	.credit {
		margin: 0 0 0.25rem 1.5rem;
		font-size: 0.85rem;
	}

	.owned,
	.credit,
	.hint {
		font-weight: 400;
		color: var(--readable-muted);
	}

	.levels li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		align-items: baseline;
		min-height: 44px;
	}
</style>
