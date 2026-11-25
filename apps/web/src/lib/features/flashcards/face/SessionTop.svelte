<script lang="ts">
	// The session top (#101, design §9): close (end the session: back where it
	// was started, with the study modal open; `onend`), a thin progress line
	// and the count. The link to /study works without the handler too.
	import { t } from '$lib/i18n';
	import IconButton from '$lib/ui/IconButton.svelte';

	let {
		progress,
		countText,
		onend
	}: { progress: { position: number; total: number }; countText: string; onend?: () => void } = $props();

	const doneCount = $derived(Math.max(0, Math.min(progress.total, progress.position - 1)));
	const width = $derived(progress.total > 0 ? (doneCount / progress.total) * 100 : 0);
</script>

<div class="session-top">
	<IconButton
		href="/study"
		icon="close"
		label={t('study.session.end')}
		onclick={(e: MouseEvent) => {
			if (!onend) return;
			e.preventDefault();
			onend();
		}}
	/>
	<div
		class="line"
		role="progressbar"
		aria-label={t('study.session.progressBar')}
		aria-valuemin="0"
		aria-valuemax={progress.total}
		aria-valuenow={doneCount}
	>
		<span style:width="{width}%"></span>
	</div>
	<span class="count" aria-live="polite" aria-atomic="true">{countText}</span>
</div>

<style>
	.session-top {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		color: var(--readable-muted);
	}
	.line {
		flex: 1;
		height: 3px;
		border-radius: 3px;
		background: var(--raised);
		overflow: hidden;
	}
	.line span {
		display: block;
		height: 100%;
		border-radius: 3px;
		background: var(--accent);
		transition: width var(--motion-medium) var(--ease-standard);
	}
	.count {
		font-size: var(--font-size-label);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	@media (forced-colors: active) {
		.line {
			outline: 1px solid CanvasText;
		}
		.line span {
			forced-color-adjust: none;
			background: Highlight;
		}
	}
</style>
