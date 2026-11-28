<script lang="ts">
	// A drill overview for PracticeList.dom.test.ts: what the list hands a drill's overview.
	import type { DrillOverviewProps } from './types';

	let { drill, items, answers, states, now }: DrillOverviewProps = $props();
</script>

<p data-testid="overview">{drill.id}: {items.length} items, {answers.length} answers, {states.size} states, {now}</p>
