<script lang="ts">
	import { t } from '$lib/i18n';
	import { getSchemes } from '$lib/api/schemes';
	import { errorText } from '$lib/api/apiErrors';
	import { flashcardsHref } from '../route';
	import { Button, Section } from '$lib/ui';
	import type { EntryBase } from '$lib/api/types';
	import { addDeckFromOverview } from './addDeckFromOverview';
	import { loadLevelItems } from './systemDeckItems';
	import { levelDecks, ownedLevelDeckId, type LevelDeck } from './systemDecks';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	// Level decks of the installed level packs, grouped by scheme and
	// collapsed. Nothing here is stored or editable: a level's items are
	// loaded when its scheme is expanded, to show how many are already yours.
	let {
		language,
		ownedEntryIds,
		workspaceId = null,
		deckIds = new Set<string>(),
		onchanged = () => {}
	}: {
		language: string;
		ownedEntryIds: ReadonlySet<number>;
		workspaceId?: number | null;
		deckIds?: ReadonlySet<string>;
		onchanged?: () => void;
	} = $props();

	let decks = $state.raw<LevelDeck[] | null>(null);
	let loadError = $state('');
	let expanded = $state<number[]>([]);
	// Per level: its items, or a failure.
	let items = $state.raw<Record<string, EntryBase[] | 'error' | undefined>>({});
	let adding = $state<string | null>(null);
	let notes = $state<Record<string, string>>({});
	let errors = $state<Record<string, string>>({});

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
				loadError = errorText(err, t('flashcards.system.loadFailed'));
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
			(list) => (items = { ...items, [key]: list }),
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

	function ownedOf(list: readonly EntryBase[]): number {
		return list.filter((entry) => ownedEntryIds.has(entry.id)).length;
	}

	function targetOf(deck: LevelDeck): { id: string; name: string; source: { type: 'level'; packId: string; level: string } } {
		return {
			id: ownedLevelDeckId(deck.packId, deck.level),
			name: `${deck.schemeName} · ${deck.level}`,
			source: { type: 'level', packId: deck.packId, level: deck.level }
		};
	}

	async function add(deck: LevelDeck, list: readonly EntryBase[]): Promise<void> {
		if (workspaceId === null) return;
		const key = keyOf(deck);
		const target = targetOf(deck);
		adding = key;
		notes = { ...notes, [key]: '' };
		errors = { ...errors, [key]: '' };
		try {
			const plan = await addDeckFromOverview(session.study, {
				workspaceId,
				items: list.map((entry) => ({
					entryId: entry.id,
					written: entry.written,
					...(deck.unit === 'character' ? { entryKind: 'character' as const } : {})
				})),
				target
			});
			notes = {
				...notes,
				[key]:
					plan.created + plan.joined === 0
						? t('flashcards.system.nothingNew', { name: target.name })
						: t('flashcards.system.added', {
								items: t(
									deck.unit === 'character'
										? 'flashcards.system.characters'
										: 'flashcards.system.words',
									{ count: plan.created + plan.joined }
								),
								name: target.name
							})
			};
			onchanged();
		} catch (err) {
			errors = { ...errors, [key]: errorText(err, t('flashcards.system.addFailed')) };
		} finally {
			adding = null;
		}
	}
</script>

<Section title={t('flashcards.system.title')}>
	<p class="hint">{t('flashcards.system.listIntro')}</p>
	{#if loadError}
		<p role="alert">{loadError}</p>
	{:else if decks === null}
		<p role="status">{t('flashcards.system.loading')}</p>
	{:else if groups.length === 0}
		<p class="hint">{t('flashcards.system.none')}</p>
	{:else}
		<ul class="groups">
			{#each groups as group (group.schemeId)}
				<li>
					<Button
						variant="secondary"
						class="toggle"
						icon={expanded.includes(group.schemeId) ? 'expand-down' : 'forward'}
						aria-expanded={expanded.includes(group.schemeId)}
						onclick={() => toggle(group)}
					>
						{group.name}
						<span class="count">{t('flashcards.system.levels', { count: group.levels.length })}</span>
					</Button>
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
											{t('flashcards.system.couldNotLoad')}
										{:else if loaded === undefined}
											{t('common.loading')}
										{:else}
											{t('flashcards.system.owned', { owned: ownedOf(loaded), total: loaded.length })}
										{/if}
									</span>
									{#if Array.isArray(loaded)}
										{@const target = targetOf(deck)}
										{#if deckIds.has(target.id)}
											<Button
												href={flashcardsHref({ view: 'deck', deckId: target.id })}
												variant="secondary"
												aria-label={t('flashcards.system.openCopyNamed', { name: `${deck.schemeName} · ${deck.level}` })}
												>{t('flashcards.system.openCopy')}</Button
											>
										{:else}
											<Button
												variant="secondary"
												aria-label={t('flashcards.system.addNamed', { name: `${deck.schemeName} · ${deck.level}` })}
												disabled={adding === keyOf(deck)}
												onclick={() => void add(deck, loaded)}
												>{adding === keyOf(deck)
													? t('flashcards.system.addingShort')
													: t('flashcards.system.addShort')}</Button
											>
										{/if}
										{#if notes[keyOf(deck)]}
											<span class="note" role="status">{notes[keyOf(deck)]}</span>
										{/if}
										{#if errors[keyOf(deck)]}
											<span class="note error" role="alert">{errors[keyOf(deck)]}</span>
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


	.count,
	.owned,
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
