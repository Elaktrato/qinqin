<script lang="ts">
	// Test double for the entry editor: one Save button that hands the
	// caller a patched entry (no form, no network).
	import type { EntryDetail } from '$lib/api/types';

	let { entry, onSaved }: { entry: EntryDetail; onSaved: (e: EntryDetail) => void } = $props();
</script>

<button type="button" onclick={() => onSaved({ ...entry, written: '勤勉' })}>Save entry</button>
