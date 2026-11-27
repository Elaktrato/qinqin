<script lang="ts">
	// The study page's notice for rows the last study load could not read
	// (docs/contracts/sync/, "Reading rows"); text and rule in unreadable.ts.
	import { useSession } from '$lib/context/context';
	import { unreadableNotice } from '$lib/studycore/unreadable';

	let { workspaceId }: { workspaceId: number | null } = $props();
	const session = useSession();
	const text = $derived(unreadableNotice(session.study.unreadable.report, workspaceId));
</script>

{#if text !== null}
	<p class="hint unreadable" role="status">{text}</p>
{/if}
