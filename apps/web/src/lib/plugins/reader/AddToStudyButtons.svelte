<script lang="ts">
	import { tick } from 'svelte';
	import { addSentence, getEntry } from '$lib/api/entries';
	import type { LookupResult } from '$lib/api/types';
	import { GENERAL_DECK_ID, addCard, setKnownMark } from '$lib/study/store';
	import { getStudyData, hasCard } from '$lib/study/studyData';
	import type { Deck } from '$lib/study/types';
	import { popupWritten } from './browse';
	import { bookSentence, resolveBookSentence } from './sentence';

	// The add-to-study buttons of one popup entry: `+` adds a vocab card to
	// General; with custom decks, "…" opens a menu to pick the deck. A word
	// added from the book also saves the sentence it was found in (when
	// `paragraph` is known: the root popup) as its example sentence.
	// "I know this" (#68) toggles the manual known mark (no card); with word
	// highlighting on, `stateLine` says how well the word is known.
	let {
		result,
		workspaceId,
		paragraph,
		hold,
		stateLine = null
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
	let trigger = $state<HTMLButtonElement | null>(null);
	let menu = $state<HTMLElement | null>(null);
	let pill = $state<HTMLElement | null>(null);
	let addButton = $state<HTMLButtonElement | null>(null);

	const term = $derived(result.term);
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

	// The open menu pins the popup (no grace hide while the pointer is
	// outside it), takes Escape before the popup does, and closes on a
	// press anywhere else.
	$effect(() => {
		if (!menuOpen) return;
		hold(true);
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.isComposing) return;
			e.preventDefault();
			closeMenu(true);
		};
		const onDown = (e: PointerEvent) => {
			if (!(e.target instanceof Node) || !root?.contains(e.target)) closeMenu(false);
		};
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('pointerdown', onDown, true);
		return () => {
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('pointerdown', onDown, true);
			hold(false);
		};
	});

	function closeMenu(refocus: boolean): void {
		menuOpen = false;
		if (refocus) trigger?.focus();
	}

	function items(): HTMLElement[] {
		return menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
	}

	async function toggleMenu(): Promise<void> {
		if (disabled) return;
		menuOpen = !menuOpen;
		if (menuOpen) {
			await tick();
			items()[0]?.focus();
		}
	}

	function menuKey(e: KeyboardEvent): void {
		const list = items();
		const at = list.indexOf(document.activeElement as HTMLElement);
		let next = -1;
		if (e.key === 'ArrowDown') next = (at + 1) % list.length;
		else if (e.key === 'ArrowUp') next = (at - 1 + list.length) % list.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = list.length - 1;
		else if (e.key === 'Tab') closeMenu(false);
		if (next >= 0) {
			e.preventDefault();
			list[next]?.focus();
		}
	}

	async function add(deckId: string): Promise<void> {
		// A second click while adding, or on a word already studied, is a
		// no-op; addCard itself dedupes too.
		if (disabled) return;
		// Keyboard users keep their place: focus inside these buttons (or
		// dropped to the page when the menu item they chose disappears)
		// moves to the "In study" pill, or back to + after a failure.
		const hadFocus = !!root?.contains(document.activeElement);
		busy = true;
		menuOpen = false;
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
				if (saved.failed) note = 'Added without the example sentence: it could not be saved.';
			}
			await addCard(entryId, {
				written: popupWritten(result),
				...(isCharacter ? { entryKind: 'character' as const } : { sentenceId }),
				deckIds: [deckId],
				workspaceId: ws
			});
			inStudy = true;
			if (!note) note = 'Added to study.';
		} catch {
			note = '';
			error = 'Could not add this word to study.';
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
			markError = 'Could not save this mark.';
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
		e.preventDefault();
	}
</script>

<div class="study" bind:this={root}>
	{#if inStudy}
		<span class="in-study" tabindex="-1" bind:this={pill}>In study</span>
	{/if}
	<button
		type="button"
		class="add"
		bind:this={addButton}
		aria-label={inStudy ? `${term} is in study` : `Add ${term} to study`}
		title={inStudy ? 'In study' : 'Add to study (General deck)'}
		{disabled}
		aria-busy={busy || inStudy === null}
		onmousedown={keepSelection}
		onclick={() => void add(GENERAL_DECK_ID)}>{busy ? '…' : inStudy ? '✓' : '+'}</button
	>
	{#if decks.length > 0}
		<button
			type="button"
			class="deck"
			bind:this={trigger}
			aria-label="Add {term} to a deck"
			title="Add to a deck"
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			{disabled}
			onmousedown={keepSelection}
			onclick={() => void toggleMenu()}>⋯</button
		>
	{/if}
	{#if menuOpen}
		<div class="menu" role="menu" tabindex="-1" aria-label="Decks" bind:this={menu} onkeydown={menuKey}>
			<button
				type="button"
				role="menuitem"
				tabindex="-1"
				onmousedown={keepSelection}
				onclick={() => void add(GENERAL_DECK_ID)}>General</button
			>
			{#each decks as deck (deck.id)}
				<button
					type="button"
					role="menuitem"
					tabindex="-1"
					onmousedown={keepSelection}
					onclick={() => void add(deck.id)}>{deck.name}</button
				>
			{/each}
		</div>
	{/if}
	<button
		type="button"
		class="know"
		aria-pressed={marked === true}
		disabled={marking || marked === null}
		onmousedown={keepSelection}
		onclick={() => void toggleKnown()}>I know this</button
	>
	{#if stateLine}<p class="state">{stateLine}</p>{/if}
	{#if note}<p class="note" role="status">{note}</p>{/if}
	{#if markError}<p class="error" role="alert">{markError}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.study {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.3rem;
		margin-left: auto;
		position: relative;
	}

	.add,
	.deck,
	.know {
		font: inherit;
		font-size: 0.95rem;
		line-height: 1;
		min-width: 1.8rem;
		height: 1.8rem;
		padding: 0 0.4rem;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 0.35rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.know[aria-pressed='true'] {
		background: color-mix(in srgb, #1b8a5a 22%, transparent);
	}

	.state {
		flex-basis: 100%;
		margin: 0;
		font-size: 0.8rem;
		text-align: right;
	}

	.add:not(:disabled):hover,
	.add:focus-visible,
	.deck:not(:disabled):hover,
	.deck:focus-visible {
		border-color: #0b6bcb;
		color: #0b6bcb;
	}

	.add:disabled,
	.deck:disabled,
	.know:disabled {
		cursor: default;
		opacity: 0.55;
	}

	.in-study {
		font-size: 0.75rem;
		padding: 0 0.4rem;
		border-radius: 0.6rem;
		background: color-mix(in srgb, #1b8a5a 22%, transparent);
	}

	.in-study:focus {
		outline: 2px solid #0b6bcb;
		outline-offset: 1px;
	}

	/* In the flow (not floating): the popup scrolls, a floating menu would be clipped. */
	.menu {
		flex-basis: 100%;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		margin-top: 0.2rem;
		padding: 0.2rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.35rem;
	}

	.menu button {
		font: inherit;
		font-size: 0.85rem;
		text-align: left;
		padding: 0.25rem 0.5rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.menu button:hover,
	.menu button:focus-visible {
		background: color-mix(in srgb, #0b6bcb 16%, transparent);
		outline: none;
	}

	.note,
	.error {
		flex-basis: 100%;
		margin: 0;
		font-size: 0.75rem;
		text-align: right;
	}

	.note {
		opacity: 0.75;
	}

	.error {
		color: #b3261e;
	}
</style>
