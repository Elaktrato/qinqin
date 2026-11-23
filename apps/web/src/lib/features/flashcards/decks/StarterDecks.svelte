<script lang="ts">
	import { t } from '$lib/i18n';
	import { getFrequencyPacks } from '$lib/api/frequency';
	import { errorText } from '$lib/api/apiErrors';
	import { noPackHint } from '$lib/study/newOrderView';
	import { flashcardsHref } from '../route';
	import { Button, Section } from '$lib/ui';
	import { addDeckFromOverview } from './addDeckFromOverview';
	import {
		loadStarterEntries,
		starterAddItems,
		starterAddedText,
		starterCredit,
		starterDecks,
		starterTarget,
		starterTitle,
		type StarterDeck
	} from './starterDecks';
	import type { StarterEntry } from '$lib/api/frequency';

	// Starter decks (#75): Top 500/1000/2000 of each installed frequency pack
	// of the workspace language, computed by the server, collapsed per pack.
	// Expanding loads the Top 2000 once; the smaller decks are its prefix.
	let {
		language,
		ownedEntryIds,
		workspaceId = null,
		deckIds = new Set<string>(),
		knownIds = new Set<number>(),
		onchanged = () => {}
	}: {
		language: string;
		ownedEntryIds: ReadonlySet<number>;
		workspaceId?: number | null;
		deckIds?: ReadonlySet<string>;
		knownIds?: ReadonlySet<number>;
		onchanged?: () => void;
	} = $props();

	let decks = $state.raw<StarterDeck[] | null>(null);
	let loadError = $state('');
	let expanded = $state<number[]>([]);
	let items = $state.raw<Record<number, StarterEntry[] | 'error' | undefined>>({});
	let adding = $state<string | null>(null);
	let notes = $state<Record<string, string>>({});
	let errors = $state<Record<string, string>>({});

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
				loadError = errorText(err, t('flashcards.starter.loadFailed'));
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
			(list) => (items = { ...items, [group.packNumId]: list }),
			() => (items = { ...items, [group.packNumId]: 'error' })
		);
	}

	function ownedOf(list: readonly StarterEntry[], size: number): string {
		const part = list.slice(0, size);
		return t('flashcards.system.owned', {
			owned: part.filter((entry) => ownedEntryIds.has(entry.id)).length,
			total: part.length
		});
	}

	function deckKey(deck: StarterDeck): string {
		return `${deck.packNumId}/${deck.size}`;
	}

	async function add(deck: StarterDeck, list: readonly StarterEntry[]): Promise<void> {
		if (workspaceId === null) return;
		const key = deckKey(deck);
		adding = key;
		notes = { ...notes, [key]: '' };
		errors = { ...errors, [key]: '' };
		try {
			const plan = await addDeckFromOverview({
				workspaceId,
				items: starterAddItems(list.slice(0, deck.size)),
				target: starterTarget(deck),
				exclude: knownIds,
				settings: { newOrder: { by: 'frequency' } }
			});
			notes = {
				...notes,
				[key]:
					plan.created + plan.joined === 0
						? t('flashcards.system.nothingNew', { name: starterTarget(deck).name })
						: starterAddedText(plan)
			};
			onchanged();
		} catch (err) {
			errors = { ...errors, [key]: errorText(err, t('flashcards.system.addFailed')) };
		} finally {
			adding = null;
		}
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
									{#if Array.isArray(loaded)}
										{@const target = starterTarget(deck)}
										{#if deckIds.has(target.id)}
											<Button
												href={flashcardsHref({ view: 'deck', deckId: target.id })}
												variant="secondary"
												aria-label={t('flashcards.system.openCopyNamed', { name: starterTitle(deck) })}
												>{t('flashcards.system.openCopy')}</Button
											>
										{:else}
											<Button
												variant="secondary"
												aria-label={t('flashcards.system.addNamed', { name: starterTitle(deck) })}
												disabled={adding === deckKey(deck)}
												onclick={() => void add(deck, loaded)}
												>{adding === deckKey(deck)
													? t('flashcards.system.addingShort')
													: t('flashcards.system.addShort')}</Button
											>
										{/if}
										{#if notes[deckKey(deck)]}
											<span class="note" role="status">{notes[deckKey(deck)]}</span>
										{/if}
										{#if errors[deckKey(deck)]}
											<span class="note error" role="alert">{errors[deckKey(deck)]}</span>
										{/if}
									{/if}
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
	.hint,
	.note {
		font-weight: 400;
		color: var(--readable-muted);
	}

	.note.error {
		color: var(--readable-bad);
	}

	.levels li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		align-items: baseline;
		min-height: 44px;
	}
</style>
