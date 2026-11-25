<script lang="ts">
	// /study (the study modal design, 4.3): the setup is a modal now. A direct
	// visit (a bookmark, an old link, the session's missing-setup redirect)
	// replaces this address with home and opens the modal there, so the
	// address bar and Back behave.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { useSession } from '$lib/context/context';
	import { t } from '$lib/i18n';
	import { pageTitle } from '$lib/routing/pageTitle';

	const session = useSession();

	onMount(() => {
		void goto('/', { replaceState: true }).then(() => {
			if (session.alive) session.studyModal.show();
		});
	});
</script>

<svelte:head>
	<title>{pageTitle(t('study.setup.title'))}</title>
</svelte:head>

<div class="page-body">
	<p class="hint" role="status">{t('study.session.opening')}</p>
</div>
