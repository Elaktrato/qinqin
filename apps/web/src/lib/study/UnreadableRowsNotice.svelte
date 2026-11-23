<script lang="ts">
	// The study page's notice for rows the last study load could not read
	// (docs/contracts/sync/, "Reading rows"); text and rule in unreadable.ts.
	import { unreadableNotice, unreadableRows } from './unreadable';

	let { workspaceId }: { workspaceId: number | null } = $props();
	const text = $derived(unreadableNotice($unreadableRows, workspaceId));
</script>

{#if text !== null}
	<p class="hint unreadable" role="status">{text}</p>
{/if}
