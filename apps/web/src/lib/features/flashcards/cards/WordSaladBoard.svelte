<script lang="ts">
	import { t } from '$lib/i18n';
	import { tick } from 'svelte';
	import { isCorrect, shuffleTokens } from '$lib/exercises/wordSalad';
	import { insertAt, insertionIndex, isDrag, moveTo, step } from '$lib/exercises/saladOrder';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import { useOptionalCardFace } from '../face/cardFace.svelte';

	interface Props {
		/** The order the learner must rebuild. */
		solution: string[];
		/** Shuffle seed for the tile bank. */
		seed: string;
		/** True once the exercise is finished: the board is locked. */
		disabled: boolean;
		onResult: (r: { wrongChecks: number; gaveUp: boolean }) => void;
		/** BCP-47 language of the tiles. */
		language?: string;
		/**
		 * The study face docks Check (#101): given, the board hands its Check
		 * (label, run, disabled) here instead of rendering it; null once locked.
		 */
		dockCheck?: (check: { label: string; run: () => void; disabled: boolean } | null) => void;
	}

	let { solution, seed, disabled, onResult, language, dockCheck }: Props = $props();

	// The grammar practice page renders this board outside the study face.
	const face = useOptionalCardFace();

	// Bank ids are positions in `bank`, so duplicate tokens stay distinct tiles.
	const bank = $derived(shuffleTokens(solution, seed));
	let placed = $state<number[]>([]);
	let wrongChecks = $state(0);
	let solved = $state(false);
	let feedback = $state('');

	const available = $derived(bank.map((_, id) => id).filter((id) => !placed.includes(id)));
	const complete = $derived(placed.length === bank.length);

	// A new sentence (or seed) starts with an empty answer row.
	$effect(() => {
		void bank;
		placed = [];
		cancelDrag();
	});

	let bankList = $state<HTMLElement | null>(null);
	let answerList = $state<HTMLElement | null>(null);
	let checkButton = $state<HTMLElement>();

	/**
	 * A tile button disappears when it moves between bank and answer, so
	 * keyboard focus is handed to the tile now at the same spot (or the
	 * last one), falling back to Check when the bank is empty.
	 */
	async function refocus(list: HTMLElement | null, at: number, fallback: HTMLElement | null) {
		await tick();
		const buttons = list === null ? [] : [...list.querySelectorAll<HTMLButtonElement>('button')];
		const target = buttons[Math.min(at, buttons.length - 1)] ?? fallback;
		target?.focus();
	}

	function place(id: number, keyboard: boolean): void {
		if (disabled) return;
		feedback = '';
		const at = available.indexOf(id);
		placed = [...placed, id];
		if (keyboard)
			void refocus(
				bankList,
				at,
				face?.primaryElement ?? checkButton ?? answerList?.querySelector('button:last-of-type') ?? null
			);
	}

	function unplace(id: number, keyboard: boolean): void {
		if (disabled) return;
		feedback = '';
		const at = placed.indexOf(id);
		placed = placed.filter((placedId) => placedId !== id);
		if (keyboard) void refocus(answerList, at, bankList?.querySelector('button') ?? null);
	}


	// ---- Drag and drop (#291) -------------------------------------------------------------------------------
	// A press on a tile becomes a drag once it moves past the slop (`isDrag`); below it the release is the tap
	// it always was. A drag is captured by the board (the dragged tile leaves its row, so it cannot hold the
	// capture), the other tiles close up and a gap the size of the tile opens where it will land.

	const uid = $props.id();
	let boardEl = $state<HTMLElement | null>(null);
	let announcement = $state('');

	type From = 'bank' | 'answer';
	interface Press {
		id: number;
		from: From;
		pointerId: number;
		pointerType: string;
		sx: number;
		sy: number;
		grabX: number;
		grabY: number;
		width: number;
		height: number;
	}
	/** The press before it is a drag (not rendered). */
	let press: Press | null = null;
	/** The drag in progress: what the rows and the lifted tile render from. */
	/** x, y: the pointer in the board's box. */
	let drag = $state<(Press & { x: number; y: number }) | null>(null);
	/** Where the tile lands in the answer row (counted without it), or null off the row. */
	let dropAt = $state<number | null>(null);
	let overBank = $state(false);
	/** The click a browser may still send after a drag ends must not also tap. */
	let swallowClick = false;

	const BAND = 24; // px around a row that still count as the row

	interface RowItem {
		key: string;
		id: number | null;
	}
	const answerItems = $derived.by<RowItem[]>(() => {
		const ids = drag !== null && drag.from === 'answer' ? placed.filter((id) => id !== drag!.id) : placed;
		const items: RowItem[] = ids.map((id) => ({ key: `t${id}`, id }));
		if (drag !== null && dropAt !== null) items.splice(Math.min(dropAt, items.length), 0, { key: 'gap', id: null });
		return items;
	});
	const bankItems = $derived(
		drag !== null && drag.from === 'bank' ? available.filter((id) => id !== drag!.id) : available
	);

	function isRtl(el: HTMLElement | null): boolean {
		return el !== null && typeof getComputedStyle === 'function' && getComputedStyle(el).direction === 'rtl';
	}

	function within(el: HTMLElement | null, x: number, y: number, band = BAND): boolean {
		if (el === null) return false;
		const r = el.getBoundingClientRect();
		return x >= r.left - band && x <= r.right + band && y >= r.top - band && y <= r.bottom + band;
	}

	function pointerDown(event: PointerEvent, id: number, from: From): void {
		if (disabled || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
		swallowClick = false;
		const tile = event.currentTarget as HTMLElement;
		const r = tile.getBoundingClientRect();
		press = {
			id,
			from,
			pointerId: event.pointerId,
			pointerType: event.pointerType,
			sx: event.clientX,
			sy: event.clientY,
			grabX: event.clientX - r.left,
			grabY: event.clientY - r.top,
			width: r.width,
			height: r.height
		};
	}

	function track(x: number, y: number): void {
		if (drag === null) return;
		// The lifted tile is placed in the board's box, which a scroll may have moved.
		const origin = boardEl?.getBoundingClientRect();
		drag.x = x - (origin?.left ?? 0);
		drag.y = y - (origin?.top ?? 0);
		overBank = false;
		// The rows sit close: the bank's own box wins over the answer row's band.
		const inBank = drag.from === 'answer' && within(bankList, x, y, 0);
		if (!inBank && within(answerList, x, y)) {
			const boxes = [...(answerList?.querySelectorAll<HTMLElement>(':scope > li[data-id]') ?? [])]
				.filter((li) => li.dataset.id !== String(drag!.id))
				.map((li) => li.getBoundingClientRect());
			dropAt = insertionIndex(boxes, x, y, isRtl(answerList));
		} else {
			dropAt = null;
			overBank = drag.from === 'answer' && within(bankList, x, y);
		}
	}

	function pointerMove(event: PointerEvent): void {
		if (press === null || event.pointerId !== press.pointerId) return;
		if (drag === null) {
			if (!isDrag(event.clientX - press.sx, event.clientY - press.sy, press.pointerType)) return;
			drag = { ...press, x: 0, y: 0 };
			try {
				boardEl?.setPointerCapture?.(press.pointerId);
			} catch {
				// The pointer is already gone; its up or cancel ends the drag.
			}
		}
		event.preventDefault();
		track(event.clientX, event.clientY);
	}

	function pointerUp(event: PointerEvent): void {
		if (press === null || event.pointerId !== press.pointerId) return;
		const current = drag;
		if (current === null) {
			press = null;
			return; // a tap: its click places or removes the tile
		}
		track(event.clientX, event.clientY);
		const at = dropAt;
		const toBank = overBank;
		cancelDrag();
		swallowClick = true;
		setTimeout(() => (swallowClick = false), 0);
		const word = bank[current.id];
		if (at !== null) {
			feedback = '';
			placed = current.from === 'answer' ? moveTo(placed, current.id, at) : insertAt(placed, current.id, at);
			announcement = t('flashcards.salad.moved', {
				word,
				position: placed.indexOf(current.id) + 1,
				count: placed.length
			});
		} else if (toBank && current.from === 'answer') {
			feedback = '';
			placed = placed.filter((id) => id !== current.id);
			announcement = t('flashcards.salad.removed', { word });
		}
	}

	function cancelDrag(): void {
		const pointerId = press?.pointerId;
		press = null;
		drag = null;
		dropAt = null;
		overBank = false;
		if (pointerId !== undefined && boardEl?.hasPointerCapture?.(pointerId)) boardEl.releasePointerCapture(pointerId);
	}

	function onWindowKeydown(event: KeyboardEvent): void {
		if (drag === null || event.key !== 'Escape') return;
		event.preventDefault();
		cancelDrag();
	}

	// Locked mid-drag (the session moved on): drop nothing.
	$effect(() => {
		if (disabled) cancelDrag();
	});

	/** Alt+Left / Alt+Right on a focused placed tile moves it one place on screen (#291). */
	async function tileKeydown(event: KeyboardEvent, id: number): Promise<void> {
		if (disabled || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const towardEnd = (event.key === 'ArrowRight') !== isRtl(answerList);
		const next = step(placed, id, towardEnd ? 1 : -1);
		if (next === null) return;
		feedback = '';
		placed = next;
		announcement = t('flashcards.salad.moved', {
			word: bank[id],
			position: next.indexOf(id) + 1,
			count: next.length
		});
		await tick();
		answerList?.querySelector<HTMLButtonElement>(`li[data-id="${id}"] button`)?.focus();
	}

	/** The tap path, unless this click only ends a drag. */
	function tap(event: MouseEvent, run: (keyboard: boolean) => void): void {
		if (swallowClick && event.detail !== 0) {
			swallowClick = false;
			return;
		}
		run(fromKeyboard(event));
	}

	// A click with detail 0 comes from the keyboard (Enter/Space).
	function fromKeyboard(event: MouseEvent): boolean {
		return event.detail === 0;
	}

	function undo(): void {
		if (disabled || placed.length === 0) return;
		feedback = '';
		placed = placed.slice(0, -1);
	}

	function check(): void {
		if (disabled) return;
		if (!complete) {
			// Check unlocks with the first tile; an unfinished sentence is a
			// wrong check, not a silent no-op.
			if (placed.length === 0) return;
			wrongChecks += 1;
			feedback = t('flashcards.salad.wrong', { count: wrongChecks });
			return;
		}
		if (
			isCorrect(
				placed.map((id) => bank[id]),
				solution
			)
		) {
			solved = true;
			feedback = wrongChecks === 0 ? t('flashcards.salad.correctClean') : t('flashcards.salad.correct');
			onResult({ wrongChecks, gaveUp: false });
			return;
		}
		wrongChecks += 1;
		feedback = t('flashcards.salad.wrong', { count: wrongChecks });
	}

	$effect(() => {
		if (dockCheck === undefined) return;
		dockCheck(disabled || solved ? null : { label: t('flashcards.card.check'), run: check, disabled: placed.length === 0 });
	});

	function giveUp(): void {
		if (disabled) return;
		feedback = t('flashcards.salad.gaveUp');
		onResult({ wrongChecks, gaveUp: true });
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div
	class="board"
	role="presentation"
	class:dragging={drag !== null}
	data-card-input
	bind:this={boardEl}
	onpointermove={pointerMove}
	onpointerup={pointerUp}
	onpointercancel={cancelDrag}
>
	<ol
		class="answer"
		class:target={drag !== null && dropAt !== null}
		aria-label={t('flashcards.salad.yourSentence')}
		lang={language}
		bind:this={answerList}
	>
		{#each answerItems as item (item.key)}
			{#if item.id === null}
				<li class="gap" data-salad-gap aria-hidden="true" style:width="{drag?.width ?? 0}px"></li>
			{:else}
				{@const id = item.id}
				<li data-id={id}>
					<button
						type="button"
						class="token placed"
						class:right={solved}
						{disabled}
						data-salad-tile
						aria-label={t('flashcards.salad.remove', { word: bank[id] })}
						aria-describedby={disabled ? undefined : `${uid}-keys`}
						onpointerdown={(event) => pointerDown(event, id, 'answer')}
						onkeydown={(event) => void tileKeydown(event, id)}
						onclick={(event) => tap(event, (keyboard) => unplace(id, keyboard))}>{bank[id]}</button
					>
				</li>
			{/if}
		{:else}
			<li class="empty">{t('flashcards.salad.empty')}</li>
		{/each}
	</ol>

	{#if !disabled}
		<!-- Hidden once finished: the full sentence is shown below. -->
		<ul
			class="bank"
			class:target={overBank}
			aria-label={t('flashcards.salad.tiles')}
			lang={language}
			bind:this={bankList}
		>
			{#each bankItems as id (id)}
				<li data-id={id}>
					<button
						type="button"
						class="token"
						data-salad-tile
						aria-label={t('flashcards.salad.place', { word: bank[id] })}
						onpointerdown={(event) => pointerDown(event, id, 'bank')}
						onclick={(event) => tap(event, (keyboard) => place(id, keyboard))}>{bank[id]}</button
					>
				</li>
			{/each}
		</ul>

		<div class="actions">
			<Button variant="secondary" disabled={placed.length === 0} onclick={undo}>{t('flashcards.salad.undo')}</Button>
			{#if dockCheck === undefined}
				<Button variant="primary" disabled={!complete} bind:element={checkButton} onclick={check}
					>{t('flashcards.card.check')}</Button
				>
			{/if}
			<Button variant="secondary" onclick={giveUp}>{t('flashcards.card.showAnswer')}</Button>
		</div>
		<span class="visually-hidden" id="{uid}-keys">{t('flashcards.salad.moveKeys')}</span>
	{/if}

	{#if drag !== null}
		<!-- The lifted tile: under a finger it rides above the touch point so the finger does not cover it. -->
		<span
			class="token ghost"
			data-salad-ghost
			aria-hidden="true"
			lang={language}
			style:width="{drag.width}px"
			style:left="{drag.x - drag.grabX}px"
			style:top="{drag.pointerType === 'touch' ? drag.y - drag.height - 12 : drag.y - drag.grabY}px"
			>{bank[drag.id]}</span
		>
	{/if}
</div>

<p class="visually-hidden" data-salad-announce aria-live="polite">{announcement}</p>

<p class="feedback" class:bad={wrongChecks > 0 && !solved} role="status" aria-live="polite">
	{#if feedback}{#if solved}<Icon name="check" size="s" />{:else if wrongChecks > 0}<Icon name="close" size="s" />{/if}<span
			>{feedback}</span
		>{/if}
</p>

<style>
	.board {
		position: relative;
		display: grid;
		gap: var(--space-4);
		justify-items: center;
		width: 100%;
	}

	.answer,
	.bank {
		box-sizing: border-box;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
		width: 100%;
		max-width: 26.25rem;
		margin: 0;
		padding: var(--space-2);
		list-style: none;
	}

	.answer {
		min-height: 3.2rem;
		border-bottom: 1px solid var(--hair);
	}

	.empty {
		align-self: center;
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}

	.token {
		min-height: var(--hit);
		min-width: var(--hit);
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--line);
		border-radius: calc(var(--radius) * 0.7);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-family: var(--font-hanzi);
		font-size: 1.125rem;
		cursor: pointer;
	}

	/* A finger's move on a tile is a drag, not a scroll or the WebView's overscroll (#291). */
	.token[data-salad-tile]:not(:disabled) {
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.board.dragging,
	.board.dragging .token {
		cursor: grabbing;
	}

	/* An empty bank stays a place to drop a tile back on. */
	.board.dragging .bank {
		min-height: calc(var(--hit) + 2 * var(--space-2));
	}

	.answer.target,
	.bank.target {
		background: var(--selected-wash);
	}

	/* Room for the tile, with the insertion marker at its start edge. */
	.gap {
		position: relative;
		box-sizing: border-box;
		min-height: var(--hit);
		border: 1px dashed var(--line);
		border-radius: calc(var(--radius) * 0.7);
		animation: open-gap var(--motion-fast) var(--ease-standard);
	}

	.gap::before {
		content: '';
		position: absolute;
		inset-block: 0;
		inset-inline-start: -1px;
		width: 3px;
		border-radius: 2px;
		background: var(--accent);
	}

	@keyframes open-gap {
		from {
			width: 0;
		}
	}

	.ghost {
		position: absolute;
		z-index: 2;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		border-color: var(--accent);
		background: var(--raised);
		box-shadow: var(--shadow-float);
	}

	/* Reduced motion: the gap and the tiles jump to place. */
	@media (prefers-reduced-motion: reduce) {
		.gap {
			animation: none;
		}
	}

	.token:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.token:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	/* A finished sentence stays fully legible: locked, not faded. */
	.token.placed:disabled {
		cursor: default;
		border-style: dashed;
	}

	.token.right,
	.token.placed.right:disabled {
		border-style: solid;
		border-color: var(--good);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
	}

	.feedback {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-height: 1.4rem;
		margin: var(--space-2) 0 0;
		font-weight: var(--weight-strong);
		color: var(--text);
	}

	.feedback.bad {
		color: var(--readable-bad);
	}

	@media (forced-colors: active) {
		.token {
			border-color: ButtonText;
		}
		.token.right,
		.token.placed.right:disabled {
			border: 2px solid Highlight;
		}
		.gap {
			border-color: ButtonText;
		}
		.gap::before {
			background: Highlight;
		}
		.ghost {
			border-color: Highlight;
		}
	}
</style>
