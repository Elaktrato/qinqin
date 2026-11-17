<script lang="ts">
	// The shown-once milestone card (docs/contracts/milestones/): nothing for
	// no plan; "recent" names each milestone with its day; "summary" names the
	// three newest and links to the history. Dismiss (and the link) marks every
	// covered milestone. Parents render this component always (view null while
	// loading), so the status region exists before its text arrives and a card
	// that appears after loading is announced once; the interactive card sits
	// outside the region. No animation, no sound.
	import type { MilestonesView } from './loadMilestones';
	import { MILESTONE_TEXT, cardHeading, moreText, statusText, titleWithDay } from './milestoneText';

	interface Props {
		view: MilestonesView | null;
		ondismiss: () => void;
		/** The card heading's level: 2 on home, 3 inside the Week tab's section. */
		headingLevel?: 2 | 3;
		locale?: string;
	}

	let { view, ondismiss, headingLevel = 2, locale }: Props = $props();

	const headingId = $props.id();
	const plan = $derived(view?.plan ?? { kind: 'none' as const });
	const status = $derived(view === null ? '' : statusText(view.plan, view.titles, locale));
	const named = $derived(plan.kind === 'recent' ? plan.items : plan.kind === 'summary' ? plan.named : []);

	function line(id: string, day: string): string {
		return titleWithDay(view?.titles.get(id) ?? id, day, locale);
	}

	function focusPageHeading(): void {
		const h1 = document.querySelector('h1');
		if (h1 === null) return;
		if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
		h1.focus();
	}

	function dismiss(): void {
		ondismiss();
		// The card goes away: never leave focus on <body>.
		focusPageHeading();
	}
</script>

<div class="milestone-status visually-hidden" role="status">{status}</div>
{#if plan.kind !== 'none'}
		<section class="milestone-card" aria-labelledby={headingId}>
			<span class="icon" aria-hidden="true">★</span>
			<div class="body">
				<svelte:element this={`h${headingLevel}`} id={headingId} class="heading">{cardHeading(plan, locale)}</svelte:element>
				<ul>
					{#each named as item (item.id)}
						<li>{line(item.id, item.day)}</li>
					{/each}
				</ul>
				{#if plan.kind === 'summary'}
					{#if plan.more > 0}<p class="more">{moreText(plan.more, locale)}</p>{/if}
					<p class="more"><a href="/stats/week#milestones" onclick={ondismiss}>{MILESTONE_TEXT.seeAll}</a></p>
				{/if}
				<button type="button" class="dismiss" aria-describedby={headingId} onclick={dismiss}>
					{MILESTONE_TEXT.dismiss}
				</button>
			</div>
		</section>
{/if}

<style>
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* No box (design §5): space and the star set it apart. */
	.milestone-card {
		display: flex;
		gap: 0.75rem;
		margin: 1.5rem 0 0;
	}

	.icon {
		font-size: 1.4rem;
		line-height: 1;
	}

	.body {
		min-width: 0;
	}

	.heading {
		margin: 0;
		font-size: 1.05rem;
	}

	ul {
		margin: 0.4rem 0 0;
		padding-left: 1.1rem;
	}

	.more {
		margin: 0.35rem 0 0;
	}

	.dismiss {
		font: inherit;
		margin-top: 0.6rem;
		padding: 0.3rem 0.8rem;
		border: 1px solid color-mix(in srgb, currentColor 60%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
</style>
