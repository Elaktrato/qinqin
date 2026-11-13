<script lang="ts">
	import type { Badge } from '$lib/api/types';
	import { badgeScheme } from './badgeText';

	let { badges }: { badges: Badge[] } = $props();
</script>

{#if badges.length > 0}
	<section class="badges" aria-labelledby="badges-heading">
		<h2 id="badges-heading">Badges</h2>
		<ul>
			{#each badges as badge (`${badge.schemeId}:${badge.levelName}`)}
				<li class="badge">
					<span class="level">{badge.levelName}</span>
					<span class="sep" aria-hidden="true">·</span>
					<span class="scheme">{badgeScheme(badge.schemeName)}</span>
					{#if badge.derived}
						<span class="derived" title="Derived from a member word’s characters">derived</span>
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
		opacity: 0.7;
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
		opacity: 0.7;
	}

	.derived {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		background: color-mix(in srgb, #0b6bcb 15%, transparent);
		color: #0b6bcb;
	}
</style>
