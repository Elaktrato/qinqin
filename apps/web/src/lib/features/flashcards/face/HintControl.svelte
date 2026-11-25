<script lang="ts">
	// The one Hint control of every card kind (#215): a small button and the H key (Alt+H inside a text
	// field). Each press reveals the next hint in the fixed order; nothing is shown when no hint is left or
	// the card is answered. The grade rule is applied by the session (lib/study/hints.ts).
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { isImeKey } from '$lib/ui/ime';
	import Button from '$lib/ui/Button.svelte';
	import { isHintKey } from '$lib/study/hintKey';
	import { useCardHints } from './cardHints.svelte';

	const hints = useCardHints();
	let announcement = $state('');
	let note = $state<HTMLElement | null>(null);
	// Focus is in a text field: there H is a letter, only Alt+H asks.
	let inTextField = $state(false);
	const FIELD = 'input, textarea, select, [contenteditable="true"], [data-card-input]';

	function ask(): void {
		const button = document.activeElement instanceof HTMLElement && document.activeElement.dataset.testid === 'hint-button';
		const kind = hints.reveal();
		if (kind === null) return;
		announcement = t(kind === 'reading' ? 'flashcards.hint.shownReading' : 'flashcards.hint.shownPicture');
		// The button goes away with the last hint: a focused button would drop focus to the page, so the
		// announcement (which says what was shown) takes it.
		if (button && !hints.canReveal) void tick().then(() => note?.focus());
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || !hints.canReveal) return;
		const target = event.target instanceof HTMLElement ? event.target : null;
		const inField = target?.closest(FIELD) != null;
		const key = {
			key: event.key,
			code: event.code,
			altKey: event.altKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			repeat: event.repeat,
			composing: isImeKey(event)
		};
		if (!isHintKey(key, inField)) return;
		event.preventDefault();
		ask();
	}
</script>

<svelte:window
	onkeydown={onKeydown}
	onfocusin={(e) => (inTextField = e.target instanceof HTMLElement && e.target.closest(FIELD) !== null)}
/>

{#if hints.canReveal}
	<Button variant="plain" onclick={ask} aria-keyshortcuts={inTextField ? 'Alt+H' : 'H Alt+H'} data-testid="hint-button">{t('flashcards.hint.button')}</Button>
{/if}
<span class="sr-only" aria-live="polite" tabindex="-1" bind:this={note} data-testid="hint-note">{announcement}</span>
