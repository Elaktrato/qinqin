<script lang="ts">
	import { webPlugins } from '$lib/plugins';
	import { t } from '$lib/i18n';
	import { pluginStates } from '$lib/plugins/states';
	import { placeWidgets } from '$lib/widgets/layout';
	import { allWidgets } from '$lib/widgets/registry';
	import { currentLanguage } from '$lib/workspaces';

	// Every widget that applies, in the registry's fixed order (core
	// first, then plugins in plugin order); only the home page is
	// arranged by the user. Plugin widgets join once the plugin states
	// are loaded, as on home.
	const states = $derived($pluginStates.status === 'ready' ? $pluginStates.list : []);
	const placed = $derived(
		placeWidgets(
			allWidgets(webPlugins, states, $currentLanguage).filter((widget) =>
				widget.surfaces.includes('stats')
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
	   one without a partner span the row (placeWidgets). */
	.widgets {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 2.5rem 1.25rem;
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
