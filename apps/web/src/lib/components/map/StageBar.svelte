<script lang="ts">
	import type { Stage } from '$lib/study/charGroups';
	import { STAGE_INFO, formatCount, stageSegments } from '$lib/study/mapGrid';

	let {
		byStage,
		size = 'small',
		decorative = false
	}: {
		byStage: Record<Stage, number>;
		size?: 'small' | 'large';
		/** Hidden from assistive technology when the numbers are said elsewhere. */
		decorative?: boolean;
	} = $props();

	const segments = $derived(stageSegments(byStage));
	const description = $derived(
		STAGE_INFO.map(({ stage, label }) => `${label} ${formatCount(byStage[stage])}`).join(', ')
	);
</script>

<!-- A stacked bar of the five stages; the numbers are in the label and the legend. -->
<span
	class="bar {size}"
	role={decorative ? undefined : 'img'}
	aria-label={decorative ? undefined : description}
	aria-hidden={decorative ? 'true' : undefined}
>
	{#each segments as segment (segment.stage)}
		<span class="seg st-{segment.stage}" style:flex-grow={segment.share}></span>
	{/each}
</span>

<style>
	.bar {
		display: flex;
		overflow: hidden;
		border-radius: 999px;
		background: transparent;
		border: 1px solid var(--line);
	}

	.small {
		width: 6rem;
		height: 0.5rem;
	}

	.large {
		width: 100%;
		height: 0.85rem;
	}

	.seg {
		flex-basis: 0;
		/* A stage with one character in 13k still shows as a sliver. */
		min-width: 3px;
	}

	/* Not studied: the empty track with a dashed outline (stage 0 is an
	   outline, not a fill: its ramp step is ~1:1 against stage 1's). */
	.st-unknown {
		background: transparent;
		outline: 1px dashed var(--line);
		outline-offset: -1px;
		min-width: 0;
	}

	.st-fresh {
		background: var(--mastery-1);
	}

	.st-learning {
		background: var(--mastery-2);
	}

	.st-mature {
		background: var(--mastery-3);
	}

	.st-learned {
		background: var(--mastery-4);
	}

	@media (forced-colors: active) {
		.bar {
			border-color: CanvasText;
		}
		.st-unknown {
			outline-color: CanvasText;
			outline-style: dotted;
		}
		.st-fresh {
			border: 1px dashed CanvasText;
		}
		.st-learning {
			border: 1px solid CanvasText;
		}
		.st-mature {
			border: 2px solid CanvasText;
		}
		.st-learned {
			border: 3px double CanvasText;
		}
	}
</style>
