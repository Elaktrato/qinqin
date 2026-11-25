<script lang="ts">
	// Home: offers "tell qinqin what you know" to a workspace that has nothing
	// yet (#74). Quiet on any failure: the offer is a nicety, never an error.
	import { getSchemes } from '$lib/api/schemes';
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import { getStudyData } from '$lib/study/data';
	import { Button } from '$lib/ui';
	import { declarableSchemes } from './levels';
	import { isDismissed, setDismissed, shouldOffer } from './offer';

	const session = useSession();

	let show = $state(false);
	let seq = 0;
	const workspace = $derived(session.workspaces.current);

	function storage(): Storage | null {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	}

	$effect(() => {
		const ws = workspace;
		const mine = ++seq;
		show = false;
		if (ws === undefined || ws === null) return;
		Promise.all([getStudyData(session.study, ws.id), getSchemes()]).then(
			([data, schemes]) => {
				if (mine !== seq) return;
				show = shouldOffer({
					cards: data.cards.length,
					marks: data.known?.length ?? 0,
					schemes: declarableSchemes(ws.language, schemes).length,
					dismissed: isDismissed(storage(), ws.id)
				});
			},
			() => undefined
		);
	});

	function later(): void {
		if (workspace) setDismissed(storage(), workspace.id);
		show = false;
	}
</script>

{#if show}
	<section class="offer" aria-labelledby="placement-offer-title" data-testid="placement-offer">
		<h2 id="placement-offer-title">{t('app.home.placementTitle')}</h2>
		<p>{t('app.home.placementText')}</p>
		<div class="row">
			<Button variant="primary" href="/settings?tab=study#known">{t('app.home.placementAction')}</Button>
			<Button variant="plain" onclick={later}>{t('app.home.placementLater')}</Button>
		</div>
	</section>
{/if}

<style>
	.offer {
		margin: var(--space-3) 0;
		padding: 0 0 var(--space-3);
		border-bottom: 1px solid var(--hair);
	}
	h2 {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
	}
	p {
		margin: 0 0 var(--space-2);
	}
	.row {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
</style>
