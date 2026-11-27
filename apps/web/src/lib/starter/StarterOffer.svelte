<script lang="ts">
	// Home: offers Starter mode to a workspace that has nothing yet (#214), next to the placement offer (#74): that one is
	// "tell us what you know", this one is "I know none of it". Quiet on any failure: the offer is a nicety.
	import { starterSets } from '$lib/api/starter';
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import { getStudyData } from '$lib/studycore/data';
	import { readStarterSettings } from './starter';
	import { Button } from '$lib/ui';
	import { isStarterDismissed, setStarterDismissed, shouldOfferStarter } from './offer';
	import StarterAdd from './StarterAdd.svelte';

	const session = useSession();

	let show = $state(false);
	let seq = 0;
	const workspace = $derived(session.workspaces.current);
	const enabled = $derived(readStarterSettings(workspace?.settings).enabled);

	function storage(): Storage | null {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	}

	$effect(() => {
		const ws = workspace;
		const on = enabled;
		const mine = ++seq;
		show = false;
		if (ws === undefined || ws === null) return;
		const code = ws.language.toLowerCase().split('-')[0];
		Promise.all([getStudyData(session.study, ws.id), starterSets()]).then(
			([data, sets]) => {
				if (mine !== seq) return;
				show = shouldOfferStarter({
					language: ws.language,
					cards: data.cards.length,
					marks: data.known?.length ?? 0,
					setAvailable: (Array.isArray(sets) ? sets : []).some((s) => s.language === code),
					enabled: on,
					dismissed: isStarterDismissed(storage(), ws.id)
				});
			},
			() => undefined
		);
	});

	function later(): void {
		if (workspace) setStarterDismissed(storage(), workspace.id);
		show = false;
	}
</script>

{#if show && workspace}
	<section class="offer" aria-labelledby="starter-offer-title" data-testid="starter-offer">
		<h2 id="starter-offer-title">{t('app.home.starterTitle')}</h2>
		<p>{t('app.home.starterText')}</p>
		<div class="row">
			<StarterAdd
				language={workspace.language}
				workspaceId={workspace.id}
				label={t('app.home.starterAction')}
				enableMode
				onadded={() => (show = false)}
			/>
			<Button variant="plain" onclick={later}>{t('app.home.starterLater')}</Button>
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
