<script lang="ts">
	import type { Badge } from '$lib/api/types';
	import { t } from '$lib/i18n';
	import { badgeSchemeParts } from './badgeText';

	let { badges }: { badges: Badge[] } = $props();
</script>

{#if badges.length > 0}
	<section class="badges" aria-labelledby="badges-heading">
		<h2 id="badges-heading">{t('entry.badges.title')}</h2>
		<ul>
			{#each badges as badge (`${badge.schemeId}:${badge.levelName}`)}
				{@const scheme = badgeSchemeParts(badge.schemeName)}
				<li class="badge">
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
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.badges {
		margin-top: 2rem;
	}

	.badges h2,
	.badges ul {
		margin: 0;
	}

	.badges h2 {
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--readable-muted);
	}

	.badges ul {
		list-style: none;
		padding: 0;
		margin-top: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.badge {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.25rem 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.4rem;
		font-size: 0.9rem;
	}

	.level {
		font-weight: 600;
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
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--reading-accent);
	}
</style>
