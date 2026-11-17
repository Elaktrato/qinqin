<script lang="ts">
	// The shown-once milestone card (docs/contracts/milestones/): nothing for
	// no plan; "recent" names each milestone with its day; "summary" names the
	// three newest and links to the history. Dismiss (and the link) marks every
	// covered milestone. Parents render this component always (view null while
	// loading), so the status region exists before its text arrives and a card
	// that appears after loading is announced once; the interactive card sits
	// outside the region. No animation, no sound.
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
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
			<span class="icon" aria-hidden="true"><Icon name="milestone" size="l" /></span>
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
				<div class="dismiss">
					<Button variant="secondary" aria-describedby={headingId} onclick={dismiss}>{MILESTONE_TEXT.dismiss}</Button>
				</div>
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

	/* A once-shown, dismissable notice is a separate object (design §5, R5):
	   one hairline outline, no fill, no shadow. */
	.milestone-card {
		display: flex;
		gap: var(--space-3);
		margin: var(--space-5) 0 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
	}

	.icon {
		display: inline-flex;
	}

	.body {
		min-width: 0;
	}

	.heading {
		margin: 0;
		font-size: var(--font-size-m);
		font-weight: var(--weight-strong);
	}

	ul {
		margin: 0.4rem 0 0;
		padding-left: 1.1rem;
	}

	.more {
		margin: 0.35rem 0 0;
	}

	.dismiss {
		margin-top: var(--space-3);
	}
</style>
