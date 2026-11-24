<script lang="ts">
	import { webPlugins } from '$lib/plugins';
	import { t } from '$lib/i18n';
	import { placeWidgets } from '$lib/widgets/layout';
	import { allWidgets } from '$lib/widgets/registry';
	import { statsOrder } from '$lib/stats/order';
	import { useSession } from '$lib/context/context';

	const session = useSession();
	// The design's default arrangement first, then every other available
	// widget in registry order (core, features, plugins); only the home
	// page is arranged by the user. Plugin widgets join once the plugin
	// states are loaded, as on home.
	const states = $derived(session.plugins.status === 'ready' ? session.plugins.list : []);
	const placed = $derived(
		placeWidgets(
			statsOrder(
				allWidgets(webPlugins, states, session.workspaces.language).filter((widget) =>
					widget.surfaces.includes('stats')
				)
			)
		)
	);
</script>

{#if placed.length > 0}
	<div class="widgets" data-widget-slot="stats">
		{#each placed as { widget, span } (widget.id)}
			{@const Widget = widget.component}
			<div class="widget" class:span data-widget={widget.id}>
				<Widget />
			</div>
		{/each}
	</div>
{:else}
	<p class="empty">{t('stats.empty')}</p>
{/if}

<style>
	/* One column on phones, two from ~900 px; wide widgets and a normal
	   one without a partner span the row (placeWidgets). No box: space
	   groups the widgets (design §5). */
	.widgets {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-6) var(--space-5);
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

	.empty {
		color: var(--readable-muted);
	}
</style>
