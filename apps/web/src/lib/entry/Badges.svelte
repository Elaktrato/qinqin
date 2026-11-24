<script lang="ts">
	// The entry's level badges as chips (#104): no section heading, no
	// bordered pills; a derived badge keeps "≈" (badgeText) and its
	// explanation title.
	import type { Badge } from '$lib/api/types';
	import { t } from '$lib/i18n';
	import Chip from '$lib/ui/Chip.svelte';
	import { badgeSchemeParts } from './badgeText';

	let { badges }: { badges: Badge[] } = $props();
</script>

{#if badges.length > 0}
	<div class="badges" role="group" aria-label={t('entry.badges.title')}>
		{#each badges as badge (`${badge.schemeId}:${badge.levelName}`)}
			{@const scheme = badgeSchemeParts(badge.schemeName)}
			<Chip>
				<span class="level">{badge.levelName}</span>
				<span class="sep" aria-hidden="true">·</span>
				<span class="scheme"
					>{scheme.base}{#if scheme.qualifier}{' '}<span aria-hidden="true"
							>{scheme.qualifier.shown}</span
						><span class="visually-hidden">{scheme.qualifier.spoken}</span>{/if}</span
				>
				{#if badge.derived}
					<span class="derived" title={t('entry.badges.derivedTitle')}>{t('entry.badges.derived')}</span>
				{/if}
			</Chip>
		{/each}
	</div>
{/if}

<style>
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.level {
		font-weight: var(--weight-strong);
	}

	.sep,
	.scheme {
		color: var(--readable-muted);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.derived {
		font-size: 0.7rem;
		padding-inline-start: var(--space-1);
		color: var(--reading-accent);
	}
</style>
