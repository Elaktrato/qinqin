<script lang="ts">
	// Test card: registers a primary action with the face, like the real cards.
	import FacePrompt from '../FacePrompt.svelte';
	import FaceWork from '../FaceWork.svelte';
	import FaceAnswer from '../FaceAnswer.svelte';
	import { usePrimary } from '../cardFace.svelte';

	let {
		label = 'Show answer',
		disabled = false,
		register = true,
		revealed = false,
		run = () => {}
	}: { label?: string; disabled?: boolean; register?: boolean; revealed?: boolean; run?: () => void } = $props();

	usePrimary(() => (register && !revealed ? { label, disabled, run } : null));
</script>

<FacePrompt><p class="fp-word">学</p></FacePrompt>
<FaceWork><p>work</p></FaceWork>
{#if revealed}<FaceAnswer><p>answer</p></FaceAnswer>{/if}
