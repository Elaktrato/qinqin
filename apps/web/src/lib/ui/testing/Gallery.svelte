<script lang="ts">
	// The component gallery (#98): every base component in its variants and
	// states, for the gallery test and the screenshots. It lives in testing/
	// and no route imports it, so it never ships (notShipped.test.ts).
	// Floating layers render open by prop inside a transformed frame, which
	// becomes the containing block of their fixed position.
	import Button from '../Button.svelte';
	import Chip from '../Chip.svelte';
	import Dialog from '../Dialog.svelte';
	import Field from '../Field.svelte';
	import Icon from '../Icon.svelte';
	import IconButton from '../IconButton.svelte';
	import Menu from '../Menu.svelte';
	import MenuItem from '../MenuItem.svelte';
	import Panel from '../Panel.svelte';
	import Section from '../Section.svelte';
	import Sheet from '../Sheet.svelte';
	import Stat from '../Stat.svelte';
	import Tabs from '../Tabs.svelte';
	import Tooltip from '../Tooltip.svelte';
	import { LUCIDE_NAMES, type IconName } from '../icons/lucide';

	const icons = Object.keys(LUCIDE_NAMES) as IconName[];
	const tabs = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'characters', label: 'Characters' },
		{ id: 'week', label: 'Week' }
	];
	let word = $state('学习');
</script>

<div class="gallery">
	<section data-gallery="Icon">
		<h2>Icons</h2>
		<div class="row icons">
			{#each icons as name (name)}<span class="icon-cell"><Icon {name} size="l" /><small>{name}</small></span>{/each}
		</div>
	</section>

	<section data-gallery="Button">
		<h2>Buttons</h2>
		<div class="row">
			<Button variant="primary">Show answer</Button>
			<Button>Edit</Button>
			<Button variant="plain">Skip</Button>
			<Button variant="filled">Sign in</Button>
			<Button tone="danger">Delete deck</Button>
			<Button variant="plain" tone="danger">Remove</Button>
			<Button icon="add">Add to deck</Button>
			<Button disabled>Disabled</Button>
			<Button busy variant="primary">Saving</Button>
		</div>
	</section>

	<section data-gallery="IconButton">
		<h2>Icon buttons and a tooltip</h2>
		<div class="row tall">
			<IconButton label="Search" icon="search" />
			<IconButton label="Play pronunciation" icon="sound" />
			<IconButton label="Bookmark" icon="bookmark" pressed />
			<IconButton label="Delete" icon="delete" disabled />
			<Tooltip text="Home" open>
				{#snippet children()}<IconButton label="Home (tooltip open)" icon="home" tooltip={false} />{/snippet}
			</Tooltip>
		</div>
	</section>

	<section data-gallery="Field">
		<h2>Fields</h2>
		<div class="grid">
			<Field label="Search" type="search" hideLabel placeholder="Search words, readings, meanings" />
			<Field label="Type the word" bind:value={word} hint="Pinyin with tone numbers works too" />
			<Field label="Email" value="mei@" error="Not an email address" />
			<Field label="Note" multiline value="A note about this word." />
		</div>
	</section>

	<section data-gallery="Tabs">
		<h2>Tabs</h2>
		<Tabs label="Stats views" {tabs} selected="overview">
			{#snippet panel(id)}<p>Panel: {id}</p>{/snippet}
		</Tabs>
		<Tabs label="Stats pages" tabs={tabs.map((t) => ({ ...t, href: `#${t.id}` }))} selected="week" />
	</section>

	<section data-gallery="Menu">
		<h2>Menus</h2>
		<div class="row menus">
			<Menu label="Workspace" text="Chinese" menuLabel="Workspaces" align="start" open>
				<MenuItem checked={true}>Chinese</MenuItem>
				<MenuItem checked={false}>Japanese</MenuItem>
				<MenuItem separator />
				<MenuItem href="#workspaces" icon="settings">Manage workspaces</MenuItem>
			</Menu>
			<Menu label="More actions" icon="more">
				<MenuItem icon="edit">Rename</MenuItem>
			</Menu>
		</div>
	</section>

	<section data-gallery="Chip">
		<h2>Chips</h2>
		<div class="row">
			<Chip>HSK 1</Chip>
			<Chip tone="accent">Top 500</Chip>
			<Chip tone="good">In 2 decks</Chip>
		</div>
	</section>

	<section data-gallery="Stat">
		<h2>Numbers</h2>
		<div class="row stats">
			<Stat value="12" label="Day streak" change={{ text: 'Same as last week', direction: 'same' }} />
			<Stat value="1,204" label="Words known" change={{ text: '+38 since last week', direction: 'up' }} />
			<Stat value="87%" label="Recall, last 30 days" change={{ text: '−2 points', direction: 'down' }} />
			<Stat value="9 h" label="Studied this month" />
		</div>
	</section>

	<section data-gallery="Section Panel">
		<h2>Sections and a panel</h2>
		<Panel>
			<Section title="Meanings" level={3}>
				<p>to study; to learn</p>
			</Section>
			<Section title="Characters" level={3}>
				{#snippet actions()}<IconButton label="Edit characters" icon="edit" size="s" />{/snippet}
				<p>学 习</p>
			</Section>
		</Panel>
		<Panel raised><p>A raised inset.</p></Panel>
	</section>

	<section data-gallery="Dialog">
		<h2>Dialog</h2>
		<div class="frame">
			<Dialog open title="Delete this deck?" description="Its cards and their history are removed. This cannot be undone.">
				{#snippet actions()}
					<Button>Keep</Button>
					<Button tone="danger">Delete</Button>
				{/snippet}
			</Dialog>
		</div>
	</section>

	<section data-gallery="Sheet">
		<h2>Sheet</h2>
		<div class="frame">
			<Sheet open label="学习">
				<p class="term">学习 <Chip>HSK 1</Chip></p>
				<p>xuéxí — to study; to learn</p>
				<div class="row"><Button variant="primary" icon="add">Add to deck</Button><Button>I know this</Button></div>
			</Sheet>
		</div>
	</section>
</div>

<style>
	.gallery {
		display: grid;
		gap: var(--space-6);
		padding: var(--space-4);
		background: var(--panel);
		color: var(--text);
		font-family: var(--font-ui);
	}
	h2 {
		margin: 0 0 var(--space-3);
		font-size: var(--font-size-label);
		font-weight: var(--weight-medium);
		color: var(--readable-muted);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.tall {
		padding-bottom: var(--space-6);
	}
	.menus {
		min-height: 13rem;
		align-items: flex-start;
	}
	.icons {
		gap: var(--space-2);
	}
	.icon-cell {
		display: grid;
		justify-items: center;
		gap: var(--space-1);
		width: 4.5rem;
	}
	.icon-cell small {
		font-size: 0.625rem;
		color: var(--readable-muted);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: var(--space-4);
	}
	.stats {
		gap: var(--space-6);
	}
	.frame {
		position: relative;
		height: 22rem;
		overflow: hidden;
		border: 1px dashed var(--hair);
		border-radius: var(--radius);
		transform: translateZ(0);
	}
	.frame :global(dialog) {
		position: absolute;
	}
	.term {
		font-size: var(--font-size-xl);
	}
</style>
