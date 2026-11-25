<script lang="ts">
	import { isImeKey } from '$lib/ui/ime';
	import { t } from '$lib/i18n';
	import { onMount, tick } from 'svelte';
	import { snippetAt } from './bookmarks';
	import type { HighlightList } from './highlightList.svelte';
	import { HIGHLIGHT_COLORS, MAX_NOTE_RUNES, type HighlightColor } from './highlights';
	import { COLOR_NAMES } from './highlightUi';
	import { placePopup } from './placement';

	// A small non-modal editor for one highlight, placed next to what
	// opened it (the highlight in the text, or its row in the panel):
	// colour, note (saved on blur and with Ctrl/Cmd+Enter), delete with a
	// confirmation. Escape closes it before anything else (a lookup popup,
	// the drawer); a delete confirmation first. Everything is text only.
	let {
		list,
		id,
		anchor,
		lang,
		focusNote = false,
		notice = '',
		initialNote,
		pending = false,
		failure = '',
		oncolor,
		ondraft,
		onretry,
		onclose
	}: {
		list: HighlightList;
		/** The highlight (a temporary id keeps working once it is saved). */
		id: number;
		/** What the editor sits next to; re-measured on scroll and resize. */
		anchor: HTMLElement;
		/** The book text's lang attribute. */
		lang: string;
		/** Open with the note field focused (the "Note" action). */
		focusNote?: boolean;
		/** A short message shown on top (an overlap, a clamped selection). */
		notice?: string;
		/** A note to start from instead of the saved one (not saved yet). */
		initialNote?: string;
		/**
		 * Opened on a highlight whose add is still pending (the "Note"
		 * action): if the add fails the editor stays, keeps the typed note
		 * and offers to try again, instead of closing with it.
		 */
		pending?: boolean;
		/** Why the pending add failed (or that a retry is running). */
		failure?: string;
		oncolor?: (color: HighlightColor) => void;
		/** The note as typed, on every change. */
		ondraft?: (draft: string) => void;
		/** Try the failed add again, with this note. */
		onretry?: (draft: string) => void;
		/**
		 * `deleted`: the highlight is gone, focus cannot return to it.
		 * `refocus`: false when a press elsewhere closed it (focus goes there).
		 */
		onclose: (how: { deleted: boolean; refocus: boolean }) => void;
	} = $props();

	let box = $state<HTMLElement | null>(null);
	let noteField = $state<HTMLTextAreaElement | null>(null);
	let size = $state({ width: 0, height: 0 });
	let rect = $state({ x: 0, y: 0, w: 0, h: 0 });
	let confirming = $state(false);
	let status = $state<'' | 'saving' | 'saved' | 'error' | 'unsaved'>('');
	let closed = false;

	const highlight = $derived(list.get(id));
	// What is shown: the highlight, or (once its pending add failed) the
	// last version of it that was seen.
	let last = $state(initial().highlight);
	let everSaved = $state(false);
	$effect(() => {
		if (!highlight) return;
		last = highlight;
		if (highlight.id > 0) everSaved = true;
	});
	const failed = $derived(pending && !highlight && !everSaved);
	const view = $derived(highlight ?? (failed ? last : null));
	// The draft is the user's: it starts from the saved note (or the given
	// one) and is only replaced by the server's cleaned version of exactly
	// what was sent.
	let draft = $state(initial().note);
	function initial(): { highlight: ReturnType<HighlightList['get']>; note: string; carried: boolean } {
		const h = list.get(id);
		const saved = h?.note ?? '';
		return { highlight: h, note: initialNote ?? saved, carried: initialNote !== undefined && initialNote !== saved };
	}
	$effect(() => ondraft?.(draft));
	// A carried-over note is not saved until the user saves it.
	if (initial().carried) status = 'unsaved';

	// A server message may come without a full stop.
	const sentence = (text: string) => (/[.!?…。]$/u.test(text.trim()) ? text.trim() : `${text.trim()}.`);

	const runes = $derived(Array.from(draft).length);
	const tooLong = $derived(runes > MAX_NOTE_RUNES);
	const titleId = $derived(`hl-editor-title-${id}`);
	const position = $derived(
		placePopup(rect, size, {
			width: typeof window === 'undefined' ? 0 : window.innerWidth,
			height: typeof window === 'undefined' ? 0 : window.innerHeight
		})
	);

	function measure(): void {
		if (!anchor.isConnected) return;
		const r = anchor.getBoundingClientRect();
		// Scrolled out of view: the editor stays at that edge of the screen
		// (its controls stay reachable) rather than leaving with it.
		const y = Math.min(Math.max(r.top, 0), Math.max(window.innerHeight - r.height, 0));
		rect = { x: r.left, y, w: r.width, h: r.height };
	}

	async function saveNote(): Promise<void> {
		const current = list.get(id);
		if (!current || draft === current.note) return;
		if (tooLong) {
			status = 'error';
			return;
		}
		const sent = draft;
		status = 'saving';
		const ok = await list.update(id, { note: sent });
		if (closed) return;
		status = ok ? 'saved' : 'error';
		const saved = list.get(id);
		// The server drops invisible control characters: show what it kept.
		if (ok && saved && draft === sent) draft = saved.note;
	}

	function pick(color: HighlightColor): void {
		oncolor?.(color);
		void list.update(id, { color });
	}

	function close(deleted = false, refocus = true): void {
		if (closed) return;
		// Nothing was saved: closing a failed editor leaves nothing behind.
		const gone = deleted || !highlight;
		if (!gone) void saveNote();
		closed = true;
		onclose({ deleted: gone, refocus });
	}

	async function askDelete(): Promise<void> {
		confirming = true;
		await tick();
		box?.querySelector<HTMLButtonElement>('.cancel')?.focus();
	}

	async function cancelDelete(): Promise<void> {
		confirming = false;
		await tick();
		box?.querySelector<HTMLButtonElement>('.delete')?.focus();
	}

	function confirmDelete(): void {
		confirming = false;
		void list.remove(id);
		close(true);
	}

	function noteKey(event: KeyboardEvent): void {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !isImeKey(event)) {
			event.preventDefault();
			void saveNote();
		}
	}

	// The highlight went away (deleted elsewhere, a book switch): nothing
	// to edit. A failed pending add keeps the editor (and the note) instead.
	$effect(() => {
		if (!highlight && !failed && !closed) {
			closed = true;
			onclose({ deleted: true, refocus: true });
		}
	});

	onMount(() => {
		measure();
		void tick().then(() => {
			if (focusNote) noteField?.focus({ preventScroll: true });
			else
				(box?.querySelector<HTMLButtonElement>('.swatch.current') ?? box?.querySelector<HTMLButtonElement>('.swatch'))?.focus({
					preventScroll: true
				});
		});
		// Escape: the confirmation first, then the editor, before any other
		// handler (capture on window runs first; they skip handled keys).
		const onKey = (e: KeyboardEvent): void => {
			if (e.key !== 'Escape' || isImeKey(e) || e.defaultPrevented) return;
			e.preventDefault();
			if (confirming) void cancelDelete();
			else close();
		};
		// A press anywhere else closes it (the note is saved first).
		const onDown = (e: PointerEvent): void => {
			if (box && e.target instanceof Node && box.contains(e.target)) return;
			close(false, false);
		};
		const onMove = (): void => measure();
		window.addEventListener('keydown', onKey, true);
		document.addEventListener('pointerdown', onDown, true);
		window.addEventListener('scroll', onMove, { capture: true, passive: true });
		window.addEventListener('resize', onMove, { passive: true });
		return () => {
			window.removeEventListener('keydown', onKey, true);
			document.removeEventListener('pointerdown', onDown, true);
			window.removeEventListener('scroll', onMove, { capture: true });
			window.removeEventListener('resize', onMove);
		};
	});
</script>

{#if view}
	<div
		bind:this={box}
		bind:offsetWidth={size.width}
		bind:offsetHeight={size.height}
		class="editor"
		data-rail-overlay
		role="dialog"
		aria-labelledby={titleId}
		style:left="{position.left}px"
		style:top="{position.top}px"
		style:max-height="{position.maxHeight}px"
	>
		<div class="head">
			<p class="title" id={titleId}>
				<span class="visually-hidden">{`${t('reader.editor.label')} `}</span><span class="snippet {view.color}" {lang}
					>{snippetAt(view.text, 60)}</span
				>
			</p>
			<button type="button" class="close" aria-label={t('reader.editor.close')} onclick={() => close()}>×</button>
		</div>
		{#if failed}
			<p class="notice failure">{t('reader.editor.noteKept', { failure: sentence(failure || t('reader.editor.failed')) })}</p>
		{:else if notice}<p class="notice">{notice}</p>{/if}

		<div class="colors" role="group" aria-label={t('reader.editor.colour')} hidden={failed}>
			{#each HIGHLIGHT_COLORS as color (color)}
				<button
					type="button"
					class="swatch {color}"
					class:current={color === view.color}
					aria-label={COLOR_NAMES[color]}
					aria-pressed={color === view.color}
					onclick={() => pick(color)}
				></button>
			{/each}
		</div>

		<label class="note-label" for="hl-editor-note-{id}">{t('reader.editor.note')}</label>
		<textarea
			bind:this={noteField}
			id="hl-editor-note-{id}"
			rows="4"
			bind:value={draft}
			onblur={() => void saveNote()}
			onkeydown={noteKey}
			oninput={() => (status = '')}
			aria-invalid={tooLong}
			aria-describedby="hl-editor-note-help-{id}"
		></textarea>
		<p class="help" id="hl-editor-note-help-{id}">
			<span class="count" class:over={tooLong}>{runes}/{MAX_NOTE_RUNES}</span>
			{#if !failed}<span>{t('reader.editor.help')}</span>{/if}
		</p>
		<!-- Saves and errors are announced by the reader's live regions. -->
		<p class="status" class:error={status === 'error'}>
			{#if status === 'unsaved'}{t('reader.editor.unsaved')}{:else if status === 'saving'}{t(
					'reader.editor.saving'
				)}{:else if status === 'saved'}{t('reader.editor.saved')}{:else if status === 'error'}{tooLong
					? t('reader.editor.tooLong', { max: MAX_NOTE_RUNES })
					: list.error || t('reader.editor.saveFailed')}{/if}
		</p>

		<div class="actions">
			{#if failed}
				<button type="button" class="retry" disabled={tooLong} onclick={() => onretry?.(draft)}>{t('reader.editor.tryAgain')}</button>
				<button type="button" onclick={() => close(true)}>{t('reader.editor.discard')}</button>
			{:else if confirming}
				<span>{t('reader.editor.deleteQuestion')}</span>
				<button type="button" class="yes" onclick={confirmDelete}>{t('reader.editor.yesDelete')}</button>
				<button type="button" class="cancel" onclick={() => void cancelDelete()}>{t('common.action.cancel')}</button>
			{:else}
				<button type="button" class="delete" onclick={() => void askDelete()}>{t('reader.editor.delete')}</button>
				<button type="button" onclick={() => close()}>{t('reader.editor.done')}</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.editor {
		position: fixed;
		z-index: 60;
		box-sizing: border-box;
		width: min(20rem, calc(100vw - 16px));
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.5rem 0.8rem 0.7rem;
		border: 1px solid var(--hair);
		border-radius: var(--radius-large);
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-float);
		font-size: 0.9rem;
		line-height: 1.45;
	}

	.head {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.title {
		margin: 0;
		flex: 1 1 auto;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.snippet {
		border-radius: 0.15em;
		padding: 0 0.1em;
	}

	.snippet.yellow {
		background: var(--highlight-wash);
	}

	.snippet.green {
		background: color-mix(in srgb, var(--highlight-green) 24%, transparent);
	}

	.snippet.blue {
		background: color-mix(in srgb, var(--highlight-blue) 24%, transparent);
	}

	.snippet.pink {
		background: color-mix(in srgb, var(--highlight-pink) 24%, transparent);
	}

	.close {
		font: inherit;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0.1rem 0.3rem;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.colors[hidden] {
		display: none;
	}

	.notice.failure {
		opacity: 1;
		color: var(--readable-bad);
	}

	.notice {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
		color: var(--readable-muted);
	}

	.colors {
		display: flex;
		gap: 0.45rem;
		margin: 0.5rem 0;
	}

	.swatch {
		box-sizing: border-box;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border-radius: 50%;
		border: 1px solid var(--line);
		cursor: pointer;
	}

	.swatch.current {
		outline: 2px solid currentColor;
		outline-offset: 1px;
	}

	.swatch.yellow {
		background: var(--highlight-yellow);
	}

	.swatch.green {
		background: var(--highlight-green);
	}

	.swatch.blue {
		background: var(--highlight-blue);
	}

	.swatch.pink {
		background: var(--highlight-pink);
	}

	.note-label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.2rem;
	}

	textarea {
		box-sizing: border-box;
		width: 100%;
		font: inherit;
		resize: vertical;
	}

	.help {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.6rem;
		margin: 0.2rem 0 0;
		font-size: 0.78rem;
		color: var(--readable-muted);
	}

	.count.over {
		color: var(--readable-bad);
		font-weight: 600;
	}

	.status {
		min-height: 1.2em;
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
	}

	.status.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		margin-top: 0.4rem;
	}

	.delete,
	.yes {
		color: var(--readable-bad);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
