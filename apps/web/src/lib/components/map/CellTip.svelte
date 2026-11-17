<script lang="ts">
	import { placePopup } from '$lib/features/reader/placement';
	import { t } from '$lib/i18n';
	import { glossLang, readingLang, studyLang } from '$lib/i18n/lang';
	import { STAGE_INFO, type TipRequest } from '$lib/study/mapGrid';

	let { tip, id, lang }: { tip: TipRequest | null; id: string; lang: string } = $props();

	const STAGE_LABEL = Object.fromEntries(STAGE_INFO.map(({ stage, label }) => [stage, label]));

	let box = $state<HTMLElement | null>(null);
	let position = $state({ left: 0, top: 0 });

	function place() {
		if (tip === null || box === null) return;
		const rect = tip.el.getBoundingClientRect();
		const placed = placePopup(
			{ x: rect.left, y: rect.top, w: rect.width, h: rect.height },
			{ width: box.offsetWidth, height: box.offsetHeight },
			{ width: window.innerWidth, height: window.innerHeight }
		);
		position = { left: placed.left, top: placed.top };
	}

	$effect(() => {
		if (tip === null || box === null) return;
		place();
		const onMove = () => place();
		window.addEventListener('scroll', onMove, { capture: true, passive: true });
		window.addEventListener('resize', onMove);
		return () => {
			window.removeEventListener('scroll', onMove, { capture: true });
			window.removeEventListener('resize', onMove);
		};
	});

	const row = $derived(tip?.cell.char ?? null);

	const status = $derived.by(() => {
		if (tip === null) return '';
		const { stage, score, reviewedCards } = tip.cell;
		const parts = [STAGE_LABEL[stage], t('stats.map.tipScore', { score })];
		if (reviewedCards > 0) parts.push(t('stats.map.tipCards', { count: reviewedCards }));
		return parts.join(' · ');
	});
</script>

<!-- One shared popover for every cell; it never takes focus or the pointer. -->
<div
	{id}
	class="tip"
	role="tooltip"
	hidden={tip === null}
	bind:this={box}
	style:left="{position.left}px"
	style:top="{position.top}px"
>
	{#if tip !== null && row !== null}
		<div class="top">
			<span class="glyph" lang={studyLang(lang)}>{row.c}</span>
			<span class="text">
				{#if row.r}<span class="reading" lang={readingLang(lang.startsWith('ja') ? 'kana' : 'pinyin', lang)}>{row.r}</span>{/if}
				{#if row.m}<span class="gloss" lang={glossLang(undefined)}>{row.m}</span>{/if}
				{#if row.v?.length}<span class="variants">{t('stats.map.alsoWritten', { variants: row.v.join(' ') })}</span>{/if}
			</span>
		</div>
		<div class="stage">
			<span class="swatch st-{tip.cell.stage}" aria-hidden="true"></span>
			<span>{status}</span>
		</div>
		{#if tip.via === 'tap'}
			<div class="more">{t('stats.map.tapAgain')}</div>
		{/if}
	{/if}
</div>

<style>
	.tip {
		position: fixed;
		z-index: 40;
		max-width: min(18rem, calc(100vw - 16px));
		padding: 0.55rem 0.7rem;
		border-radius: 0.5rem;
		border: 1px solid var(--st-edge);
		background: var(--st-tip-bg);
		color: var(--st-tip-fg);
		box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
		font-size: 0.9rem;
		pointer-events: none;
	}

	.tip[hidden] {
		display: none;
	}

	.top {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}

	.glyph {
		font-size: 2rem;
		line-height: 1;
	}

	.text {
		display: grid;
		gap: 0.1rem;
	}

	.reading {
		font-weight: 600;
	}

	.variants,
	.more {
		opacity: 0.75;
		font-size: 0.8rem;
	}

	.stage {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.4rem;
	}

	.more {
		margin-top: 0.25rem;
	}

	.swatch {
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 0.2rem;
		border: 1px solid var(--st-edge);
	}

	.st-unknown {
		background: var(--st-unknown-bg);
		border-style: dashed;
	}

	.st-fresh {
		background: var(--st-fresh-bar);
	}

	.st-learning {
		background: var(--st-learning-bar);
	}

	.st-mature {
		background: var(--st-mature-bar);
	}

	.st-learned {
		background: var(--st-learned-bar);
	}
</style>
