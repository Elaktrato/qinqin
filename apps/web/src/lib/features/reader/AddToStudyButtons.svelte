<script lang="ts">
	import { t } from '$lib/i18n';
	import { tick } from 'svelte';
	import { addSentence, getEntry } from '$lib/api/entries';
	import type { LookupResult } from '$lib/api/types';
	import { GENERAL_DECK_ID, addCard, setKnownMark } from '$lib/study/store';
	import { getStudyData, hasCard } from '$lib/study/studyData';
	import { PROMPT_MIN_COUNT } from '$lib/lookups/lookups';
	import { lookupRecorder } from '$lib/lookups/store';
	import type { Deck } from '$lib/study/types';
	import { popupWritten } from './browse';
	import { Button, Chip, Menu, MenuItem } from '$lib/ui';
	import { bookSentence, resolveBookSentence } from './sentence';

	// The study actions of one popup entry (design §9 "Reader", #102): the
	// primary "Add to deck" adds a vocab card to General in one click; with
	// custom decks, "Choose a deck" (lib/ui Menu) picks another. A word
	// added from the book also saves the sentence it was found in (when
	// `paragraph` is known: the root popup) as its example sentence.
	// "I know this" (#68) toggles the manual known mark (no card); with word
	// highlighting on, `stateLine` says how well the word is known.
	let {
		result,
		workspaceId,
		paragraph,
		hold,
		stateLine = null,
		first = false
	}: {
		result: LookupResult;
		/** The workspace the card goes to: the book's. */
		workspaceId: number;
		/** The paragraph the result's offsets refer to; null in nested popups. */
		paragraph: string | null;
		/** Pins the popup while the deck menu is open. */
		hold: (on: boolean) => void;
		/** "New word", "Learning", "Known — …"; null hides the line. */
		stateLine?: string | null;
		/** The first result of the popup (the one a lookup records). */
		first?: boolean;
	} = $props();


	// null: not known yet (toggle disabled).
	let marked = $state<boolean | null>(null);
	let marking = $state(false);
	let markError = $state('');

	// null: not known yet (buttons disabled). A failed check frees the
	// buttons: a click then reports the real error.
	let inStudy = $state<boolean | null>(null);
	let decks = $state<Deck[]>([]);
	let busy = $state(false);
	let menuOpen = $state(false);
	let note = $state('');
	let error = $state('');
	let root = $state<HTMLElement | null>(null);
	let pill = $state<HTMLElement | null>(null);
	let addButton = $state<HTMLElement | undefined>(undefined);

	const term = $derived(result.term);
	// The lookup history's hint (#72): the root popup's first result, looked
	// up often, with no card and no "I know this" mark. The count comes from
	// the recorder's memory (0 while recording is off); no request per popup.
	const lookedUp = $derived(first && paragraph !== null ? lookupRecorder().countOf(workspaceId, result.entryId) : 0);
	const showLookedUp = $derived(lookedUp >= PROMPT_MIN_COUNT && inStudy === false && marked === false);
	const disabled = $derived(busy || inStudy !== false);

	$effect(() => {
		const entryId = result.entryId;
		const ws = workspaceId;
		let stale = false;
		inStudy = null;
		marked = null;
		getStudyData(ws).then(
			(data) => {
				if (stale) return;
				marked = (data.known ?? []).includes(entryId);
				decks = [...data.decks].sort(
					(a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
				);
				inStudy = hasCard(data.cards, entryId);
			},
			() => {
				if (stale) return;
				decks = [];
				inStudy = false;
				marked = false;
			}
		);
		return () => {
			stale = true;
		};
	});

	// The open deck menu pins the popup (no grace hide while the pointer is
	// outside it). The Menu takes Escape before the popup does.
	$effect(() => {
		if (!menuOpen) return;
		hold(true);
		return () => hold(false);
	});

	async function add(deckId: string): Promise<void> {
		// A second click while adding, or on a word already studied, is a
		// no-op; addCard itself dedupes too.
		if (disabled) return;
		// Keyboard users keep their place: focus inside these buttons (or
		// dropped to the page when the menu item they chose disappears)
		// moves to the "In study" pill, or back to + after a failure.
		const hadFocus = !!root?.contains(document.activeElement);
		busy = true;
		note = '';
		error = '';
		const entryId = result.entryId;
		const ws = workspaceId;
		try {
			try {
				if (hasCard((await getStudyData(ws)).cards, entryId)) {
					inStudy = true;
					return;
				}
			} catch {
				// addCard reads again and reports a real failure.
			}
			let sentenceId: number | undefined;
			const isCharacter = result.kind === 'character';
			const text = paragraph && !isCharacter ? bookSentence(paragraph, result.start, result.end) : '';
			if (text) {
				const saved = await resolveBookSentence({ getEntry, addSentence }, entryId, text);
				sentenceId = saved.sentenceId;
				if (saved.failed) note = t('reader.study.noSentence');
			}
			await addCard(ws, entryId, {
				written: popupWritten(result),
				...(isCharacter ? { entryKind: 'character' as const } : { sentenceId }),
				deckIds: [deckId]
			});
			inStudy = true;
			if (!note) note = t('reader.study.added');
		} catch {
			note = '';
			error = t('reader.study.addFailed');
		} finally {
			busy = false;
			if (hadFocus) await restoreFocus();
		}
	}

	async function toggleKnown(): Promise<void> {
		if (marking || marked === null) return;
		const next = !marked;
		marking = true;
		markError = '';
		marked = next;
		try {
			await setKnownMark(workspaceId, result.entryId, next);
		} catch {
			marked = !next;
			markError = t('reader.study.markFailed');
		} finally {
			marking = false;
		}
	}

	async function restoreFocus(): Promise<void> {
		await tick();
		const active = document.activeElement;
		const lost = !active || active === document.body || !active.isConnected;
		if (lost || !root?.contains(active) || (active as HTMLButtonElement).disabled) {
			(inStudy ? pill : addButton)?.focus();
		}
	}

	// Keeps a text selection (selection popups) when a button is pressed.
	function keepSelection(e: MouseEvent): void {
		if (e.target instanceof Element && e.target.closest('button')) e.preventDefault();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="study" bind:this={root} onmousedown={keepSelection}>
	<div class="actions">
		{#if inStudy}
			<span class="in-study" tabindex="-1" bind:this={pill}><Chip tone="good">{t('reader.study.inStudy')}</Chip></span>
		{:else}
			<Button
				variant="primary"
				icon="add"
				bind:element={addButton}
				aria-label={t('reader.study.addNamed', { term })}
				{disabled}
				aria-busy={busy || inStudy === null}
				onclick={() => void add(GENERAL_DECK_ID)}>{t('reader.study.addToDeck')}</Button
			>
			{#if decks.length > 0 && !disabled}
				<Menu label={t('reader.study.chooseDeck')} menuLabel={t('reader.study.decks')} icon="expand-down" align="start" bind:open={menuOpen}>
					<MenuItem onselect={() => void add(GENERAL_DECK_ID)}>{t('reader.study.general')}</MenuItem>
					{#each decks as deck (deck.id)}
						<MenuItem onselect={() => void add(deck.id)}>{deck.name}</MenuItem>
					{/each}
				</Menu>
			{/if}
		{/if}
		<Button
			icon={marked ? 'check' : undefined}
			aria-pressed={marked === true}
			disabled={marking || marked === null}
			onclick={() => void toggleKnown()}>{t('reader.study.know')}</Button
		>
	</div>
	{#if stateLine}<p class="state">{stateLine}</p>{/if}
	{#if showLookedUp}<p class="state looked-up">{t('reader.study.lookedUp', { count: lookedUp })}</p>{/if}
	{#if note}<p class="note" role="status">{note}</p>{/if}
	{#if markError}<p class="error" role="alert">{markError}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.study {
		display: grid;
		gap: var(--space-1);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.in-study:focus {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
		border-radius: var(--radius);
	}

	.state,
	.note,
	.error {
		margin: 0;
		font-size: var(--font-size-xs);
	}

	.state,
	.note {
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
