<script lang="ts">
	import { pageTitle } from '$lib/routing/pageTitle';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { t } from '$lib/i18n';
	import { formatDay } from '$lib/i18n/format';
	import Button from '$lib/ui/Button.svelte';
	import Field from '$lib/ui/Field.svelte';
	import Msg from '$lib/ui/Msg.svelte';
	import EmailBanner from '$lib/account/EmailBanner.svelte';
	import PlacementOffer from '$lib/placement/PlacementOffer.svelte';
	import StarterOffer from '$lib/starter/StarterOffer.svelte';
	import StartOffer from '$lib/starter/StartOffer.svelte';
	import LevelCheckOffer from '$lib/placement/LevelCheckOffer.svelte';
	import HomeMilestones from '$lib/milestones/HomeMilestones.svelte';
	import { homeEmptyReason, placeWidgets, resolveLayout } from '$lib/widgets/layout';
	import { heldLayout, refreshLayout } from '$lib/widgets/homeData';
	import { allWidgets } from '$lib/widgets/registry';
	import { useSession } from '$lib/context/context';


	const session = useSession();
	let query = $state('');
	// Where the workspace's language has a course, its start card stands in for the Starter and placement offers
	// (#225); they wait until it has settled, so they never flash in first. null: not settled yet.
	let courseStart = $state<boolean | null>(null);

	// The greeting follows the device's hour; the date line is the learner's
	// today (their study-day zone), which can differ near midnight.
	const now = new Date();
	const hour = now.getHours();
	const greeting =
		hour < 12 ? t('app.home.greeting.morning') : hour < 18 ? t('app.home.greeting.afternoon') : t('app.home.greeting.evening');
	const dateLine = formatDay(session.zone.day().today(now.getTime()), { weekday: 'long', day: 'numeric', month: 'long' });

	// The user's home layout (null = none stored, so the default). Nothing
	// renders until it is known, so a custom order never flashes as the
	// default first; a failed load falls back to the default quietly. A layout
	// this session (or this user's device copy) holds shows at once and is
	// refreshed behind it (#290).
	const held = heldLayout(session);
	let stored = $state<string[] | null>(held?.ids ?? null);
	let layoutReady = $state(held !== null);

	// Feature widgets join once the shared feature switches are loaded; until
	// then, or when they failed, only the core widgets can be shown.
	const states = $derived(session.features.status === 'ready' ? session.features.list : []);
	const placed = $derived(
		placeWidgets(resolveLayout(stored, allWidgets(states, session.workspaces.language), 'home'))
	);
	const emptyReason = $derived(homeEmptyReason(stored, placed.length));
	const switchesSettled = $derived(session.features.status === 'ready' || session.features.status === 'error');
	// A refresh behind the held study rows or log failed (#290): the widgets keep
	// what they show, and one quiet line says it may be out of date.
	const notRefreshed = $derived(session.workspaces.current !== null && session.study.refresh.failed(session.workspaces.current.id));

	onMount(async () => {
		try {
			stored = await refreshLayout(session);
		} catch {
			// The held layout stays; with none, the default.
			if (!layoutReady) stored = null;
		} finally {
			layoutReady = true;
		}
	});

	async function search(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		await goto(`/search?q=${encodeURIComponent(query.trim())}`);
	}
</script>

<svelte:head>
	<title>{pageTitle()}</title>
</svelte:head>

<div class="page-body home">
	<header class="greet">
		<h1>{greeting}</h1>
		<p class="date">{dateLine}</p>
	</header>

	<EmailBanner />
	<StartOffer onsettle={(applies) => (courseStart = applies)} />
	{#if courseStart === false}
		<PlacementOffer />
		<StarterOffer />
	{/if}
	<LevelCheckOffer />

	<form class="search" role="search" onsubmit={search}>
		<div class="search-field">
			<Field
				label={t('app.home.searchLabel')}
				hideLabel
				type="search"
				name="q"
				data-testid="home-search"
				bind:value={query}
				placeholder={t('app.home.searchPlaceholder')}
			/>
		</div>
		<Button type="submit" variant="plain">{t('app.home.searchButton')}</Button>
	</form>

	<!-- Not a widget: a stored layout must never hide it (milestones contract). -->
	<HomeMilestones />

	{#if notRefreshed}
		<p class="not-refreshed" role="status">{t('app.home.notRefreshed')}</p>
	{/if}

	{#if layoutReady}
		{#if placed.length > 0}
			<div class="widgets" data-widget-slot="home">
				{#each placed as { widget, span } (widget.id)}
					{@const Widget = widget.homeComponent ?? widget.component}
					<div class="widget" class:span data-widget={widget.id}>
						<Widget />
					</div>
				{/each}
			</div>
		{:else if switchesSettled}
			<p class="empty">
				{emptyReason === 'none-chosen'
					? t('app.home.noWidgets')
					: t('app.home.noWidgetsHere')}
				<Msg key="app.home.chooseWidgets">{#snippet link(text: string)}<a href="/settings?tab=layout">{text}</a>{/snippet}</Msg>
			</p>
		{/if}
	{/if}
</div>

<style>
	.greet {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
		margin-bottom: var(--space-5);
	}

	.greet h1 {
		margin: 0;
		font-size: var(--font-size-xl);
		font-weight: var(--weight-strong);
		letter-spacing: -0.01em;
	}

	.date {
		margin: 0;
		color: var(--readable-muted);
	}

	.search {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		max-width: 32rem;
	}

	.search-field {
		flex: 1;
		min-width: 0;
	}

	/* One column on phones, two from ~900 px; wide widgets and a normal
	   one without a partner span the row (placeWidgets). */
	.widgets {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-6) var(--space-5);
		margin-top: var(--space-6);
	}

	@media (min-width: 900px) {
		.widgets {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.widget.span {
			grid-column: 1 / -1;
		}
	}

	.widget {
		min-width: 0;
	}

	/* A widget with nothing to show renders nothing (Continue course without a course, #225): no empty grid cell. */
	.widget:empty {
		display: none;
	}

	.not-refreshed {
		margin: var(--space-4) 0 0;
		font-size: var(--font-size-s);
		color: var(--readable-muted);
	}

	.empty {
		margin-top: var(--space-6);
		color: var(--readable-muted);
	}
</style>
