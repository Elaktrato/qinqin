<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { UserError } from '$lib/api/userError';
	import { t } from '$lib/i18n';
	import { addCard } from '$lib/study/commands/cards';
	import { GENERAL_DECK_ID } from '$lib/study/types';
	import { getStudyData, hasCard } from '$lib/study/data';
	import type { Deck } from '$lib/study/types';
	import Button from '$lib/ui/Button.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Menu from '$lib/ui/Menu.svelte';
	import MenuItem from '$lib/ui/MenuItem.svelte';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	// `written` is snapshotted onto the card; `sentenceId` is the example
	// sentence shown on the review front.
	let {
		entryId,
		written,
		sentenceId,
		kind,
		onadded,
		onchange
	}: {
		entryId: number;
		written: string;
		sentenceId?: number;
		kind?: string;
		/** A successful add in this view (the entry page refreshes its deck count). */
		onadded?: () => void;
		/** Whether a card exists, for the phone bar's Add to deck button. */
		onchange?: (inDeck: boolean | null) => void;
	} = $props();

	// Whether this entry already has a card in the current workspace.
	// `null` means "not known yet": the check is still running, so the
	// button stays disabled. Only a failed check frees it, because the
	// click then has to surface the real error.
	let inDeck = $state<boolean | null>(null);
	// The workspace's custom decks; General is the default and always exists.
	let decks = $state<Deck[]>([]);
	let saving = $state(false);
	// Set only by a successful add in this view, so the note is not shown
	// for entries that were already in the deck.
	let justAdded = $state(false);
	let error = $state('');

	// The phone bar's Add to deck follows this (it is rendered outside this
	// component's markup).
	$effect(() => onchange?.(inDeck));

	// A failed load must not hide the button: an unavailable workspace or
	// a flaky pull is reported when the user actually tries to add. Until
	// the check answers, though, the button is disabled: it must never
	// offer to add an entry that is already in the deck. The study data
	// comes from the session's study cache (study/data.ts).
	/** The workspace the "in deck" check ran against: an add goes there (#174). */
	let checkedWorkspace: number | null = null;

	$effect(() => {
		const id = entryId;
		const workspaceId = session.workspaces.current?.id ?? null;
		checkedWorkspace = workspaceId;
		let stale = false;
		inDeck = null;
		justAdded = false;
		error = '';
		decks = [];
		void (async () => {
			if (workspaceId === null) {
				// addCard would throw; keep the button enabled so a click
				// can explain why nothing can be added yet.
				inDeck = false;
				return;
			}
			try {
				const data = await getStudyData(session.study, workspaceId);
				if (stale) return;
				decks = [...data.decks].sort(
					(a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
				);
				inDeck = hasCard(data.cards, id);
			} catch {
				if (stale) return;
				inDeck = false;
			}
		})();
		return () => {
			stale = true;
		};
	});

	/** addToGeneral is the phone bar's one-click add (the same path as the button). */
	export function addToGeneral(): void {
		void add(GENERAL_DECK_ID);
	}

	async function add(deckId: string): Promise<void> {
		// Unresolved or already-added means "no new card"; addCard itself
		// is idempotent, so a race across tabs cannot duplicate either.
		// The workspace the "in deck" check ran against, captured at the click (#174).
		const ws = checkedWorkspace;
		if (saving || inDeck !== false) return;
		saving = true;
		error = '';
		try {
			// The written form is snapshotted onto the card for per-character
			// mastery, and the first example sentence travels with it so the
			// review front can show the word in context. An existing card is
			// returned unchanged, so the chosen deck is only used for a
			// genuinely new card.
			// A character card has no sentence and carries the entryKind
			// snapshot, the same row a level session creates.
			const isCharacter = kind === 'character';
			if (ws === null) throw new UserError('entry.study.noWorkspace');
			await addCard(session.study, ws, entryId, {
				written,
				...(isCharacter ? { entryKind: 'character' as const } : { sentenceId }),
				deckIds: [deckId]
			});
			inDeck = true;
			justAdded = true;
			onadded?.();
		} catch (err) {
			error = errorText(err, t('entry.study.addFailed'));
		} finally {
			saving = false;
		}
	}
</script>

<div class="add-to-study">
	<div class="actions">
		{#if inDeck === true}
			<span class="in-study"><Chip tone="good"><Icon name="check" size="s" />{t('entry.study.inDeck')}</Chip></span>
		{:else}
			<Button
				variant="primary"
				icon="add"
				disabled={saving || inDeck !== false}
				aria-busy={saving || inDeck === null}
				onclick={() => void add(GENERAL_DECK_ID)}
			>
				{saving ? t('entry.study.adding') : inDeck === null ? t('entry.study.checking') : t('entry.study.add')}
			</Button>
			{#if decks.length > 0 && !saving}
				<Menu
					label={t('entry.study.chooseDeck')}
					menuLabel={t('entry.study.deck')}
					icon="expand-down"
					align="start"
				>
					<MenuItem onselect={() => void add(GENERAL_DECK_ID)}>{t('entry.study.general')}</MenuItem>
					{#each decks as deck (deck.id)}
						<MenuItem onselect={() => void add(deck.id)}>{deck.name}</MenuItem>
					{/each}
				</Menu>
			{/if}
		{/if}
	</div>
	{#if justAdded}
		<p class="note" role="status">
			{t('entry.study.added')}
		</p>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</div>

<style>
	.add-to-study {
		display: grid;
		gap: var(--space-1);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.note,
	.error {
		margin: 0;
		font-size: var(--font-size-label);
	}

	.note {
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		font-weight: var(--weight-strong);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
