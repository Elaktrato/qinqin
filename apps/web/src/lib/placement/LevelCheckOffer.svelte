<script lang="ts">
	// Home: a quiet note that the (experimental) level check exists, for a learner who has started (#82). It links to
	// Settings → Study, where the check lives; nothing runs here. Quiet on any failure: the offer is a nicety.
	import { getSchemes } from '$lib/api/schemes';
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import { getStudyData } from '$lib/study/data';
	import { Button, Chip } from '$lib/ui';
	import { declarableSchemes } from './levels';
	import { isLevelCheckDismissed, setLevelCheckDismissed, shouldOfferLevelCheck } from './levelCheckOffer';

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
				show = shouldOfferLevelCheck({
					cards: data.cards.length,
					marks: data.known?.length ?? 0,
					schemes: declarableSchemes(ws.language, schemes).length,
					dismissed: isLevelCheckDismissed(storage(), ws.id)
				});
			},
			() => undefined
		);
	});

	function later(): void {
		if (workspace) setLevelCheckDismissed(storage(), workspace.id);
		show = false;
	}
</script>

{#if show && workspace}
	<section class="offer" aria-labelledby="level-check-offer-title" data-testid="level-check-offer">
		<h2 id="level-check-offer-title">{t('app.home.levelCheckTitle')} <Chip tone="accent">{t('settings.levelCheck.experimental')}</Chip></h2>
		<p>{t('app.home.levelCheckText')}</p>
		<div class="row">
			<a class="open" href="/settings?tab=study#level-check">{t('app.home.levelCheckAction')}</a>
			<Button variant="plain" onclick={later}>{t('app.home.levelCheckLater')}</Button>
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
		align-items: center;
	}
</style>
