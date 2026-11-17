<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { ApiError } from '$lib/api/client';
	import {
		discardStaged,
		installStaged,
		listPacks,
		stagePack,
		uninstallPack,
		waitForImport,
		type InstalledPack,
		type StagedPack
	} from '$lib/api/packs';
	import { getCatalogue, type Catalogue } from '$lib/api/packages';
	import type { UploadProgress } from '$lib/api/upload';
	import { languageLabel } from '$lib/languages';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import {
		groupPacks,
		licenceCaution,
		licenceConfirmation,
		licenceLabel,
		licenceLine,
		packLanguages,
		packageLine,
		packagesBuilding,
		packagesOf,
		packagesUnavailable,
		progressText,
		replaceLines,
		contrastSummary,
		contrastView,
		uninstallWarning
	} from './packsView';

	type Phase = 'idle' | 'uploading' | 'review' | 'importing';

	let packs = $state<InstalledPack[]>([]);
	let loading = $state(true);
	let loadError = $state('');

	// What the server has built from the installed packs (GET /api/packages); null until read.
	let catalogue = $state<Catalogue | null>(null);
	let catalogueFailed = $state(false);

	async function loadCatalogue(): Promise<void> {
		try {
			catalogue = await getCatalogue();
			catalogueFailed = false;
		} catch {
			catalogue = null;
			catalogueFailed = true;
		}
	}

	let phase = $state<Phase>('idle');
	let fileInput = $state<HTMLInputElement>();
	let file = $state<File | null>(null);
	let progress = $state<UploadProgress>({ loaded: 0, total: 0 });
	let staged = $state<StagedPack | null>(null);
	let confirmed = $state(false);
	let notice = $state('');
	// Called after an install or uninstall changed the installed packs.
	let { onchange }: { onchange?: () => void } = $props();

	let error = $state('');
	let upload: AbortController | null = null;
	let poll: AbortController | null = null;

	let pending = $state<InstalledPack | null>(null);
	let uninstalling = $state(false);
	let dialog = $state<HTMLDialogElement>();
	let listHeading = $state<HTMLHeadingElement>();

	const groups = $derived(groupPacks(packs));
	const checking = $derived(phase === 'uploading' && progress.total > 0 && progress.loaded >= progress.total);
	const caution = $derived(staged ? licenceCaution(staged.manifest.license) : null);
	const replaces = $derived(staged ? replaceLines(staged) : []);

	function message(err: unknown, fallback: string): string {
		return err instanceof ApiError ? err.message : fallback;
	}

	async function load(): Promise<void> {
		loading = true;
		loadError = '';
		try {
			packs = await listPacks();
			void loadCatalogue();
		} catch (err) {
			packs = [];
			loadError = message(err, t('packs.error.load'));
		} finally {
			loading = false;
		}
	}

	onMount(load);

	// A pack staged but never installed is dropped when the page goes
	// away (best effort; the server also expires it after 30 minutes).
	onDestroy(() => {
		upload?.abort();
		poll?.abort();
		if (staged && phase === 'review') void discardStaged(staged.token).catch(() => {});
	});

	function pick(event: Event): void {
		file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
		error = '';
		notice = '';
	}

	async function startUpload(): Promise<void> {
		if (!file || phase !== 'idle') return;
		error = '';
		notice = '';
		progress = { loaded: 0, total: 0 };
		upload = new AbortController();
		phase = 'uploading';
		try {
			staged = await stagePack(file, { onProgress: (p) => (progress = p), signal: upload.signal });
			confirmed = false;
			phase = 'review';
		} catch (err) {
			phase = 'idle';
			if (err instanceof DOMException && err.name === 'AbortError') notice = t('packs.upload.cancelled');
			else error = message(err, t('packs.upload.failed'));
		} finally {
			upload = null;
		}
	}

	function cancelUpload(): void {
		upload?.abort();
	}

	function resetForm(): void {
		staged = null;
		confirmed = false;
		file = null;
		if (fileInput) fileInput.value = '';
		phase = 'idle';
	}

	async function discard(): Promise<void> {
		if (!staged) return;
		const token = staged.token;
		resetForm();
		try {
			await discardStaged(token);
			notice = t('packs.discarded');
		} catch (err) {
			error = message(err, t('packs.error.discard'));
		}
	}

	async function install(): Promise<void> {
		if (!staged || !confirmed || phase !== 'review') return;
		const { token, manifest } = staged;
		error = '';
		notice = '';
		try {
			// The licence echoed here is the one shown in the review card.
			await installStaged(token, manifest.license);
		} catch (err) {
			error = message(err, t('packs.error.startImport'));
			return;
		}
		phase = 'importing';
		poll = new AbortController();
		try {
			const result = await waitForImport(token, { signal: poll.signal });
			if (result.status === 'done') {
				notice = t('packs.installed', { name: manifest.name, summary: result.summary ?? t('packs.installedDone') });
				if (result.warning) error = result.warning;
				await load();
				onchange?.();
			} else {
				error = result.error ?? t('packs.error.importFailed');
			}
			resetForm();
		} catch (err) {
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				error = message(err, t('packs.error.lostContact'));
				resetForm();
			}
		} finally {
			poll = null;
		}
	}

	async function askUninstall(pack: InstalledPack): Promise<void> {
		pending = pack;
		await tick();
		dialog?.showModal();
	}

	function closeDialog(): void {
		dialog?.close();
		pending = null;
	}

	async function confirmUninstall(): Promise<void> {
		if (!pending) return;
		const pack = pending;
		uninstalling = true;
		error = '';
		notice = '';
		try {
			await uninstallPack(pack.type, pack.packId);
			notice = t('packs.uninstalled', { name: pack.name || pack.packId });
			await load();
			onchange?.();
		} catch (err) {
			error = message(err, t('packs.error.uninstall'));
		} finally {
			uninstalling = false;
			closeDialog();
			// The uninstalled row's button is gone: keep keyboard focus on the list.
			await tick();
			listHeading?.focus();
		}
	}

	function fmtDate(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
	}
</script>

<section class="packs" aria-labelledby="packs-heading">
	<h2 id="packs-heading" tabindex="-1" bind:this={listHeading}>{t('packs.title')}</h2>
	<p class="hint">{t('packs.intro')}</p>

	<form class="install" onsubmit={(event) => { event.preventDefault(); void startUpload(); }}>
		<label class="file">
			<span>{t('packs.upload.file')}</span>
			<input
				bind:this={fileInput}
				type="file"
				accept=".zip,application/zip"
				onchange={pick}
				disabled={phase !== 'idle'}
			/>
		</label>
		<button type="submit" disabled={!file || phase !== 'idle'}>{t('packs.upload.submit')}</button>
	</form>

	{#if phase === 'uploading'}
		<div class="progress" role="status">
			{#if checking}
				<p>{t('packs.upload.checking')}</p>
				<progress aria-label={t('packs.upload.checkingLabel')}></progress>
			{:else}
				<p>{t('packs.upload.progress', { progress: progressText(progress) })}</p>
				<progress max={progress.total || 1} value={progress.loaded} aria-label={t('packs.upload.progressLabel')}></progress>
			{/if}
			<button type="button" onclick={cancelUpload}>{t('common.action.cancel')}</button>
		</div>
	{/if}

	{#if staged && (phase === 'review' || phase === 'importing')}
		<div class="review" role="region" aria-labelledby="review-heading">
			<h3 id="review-heading">{t('packs.review.title')}</h3>
			<p class="hint">{t('packs.review.intro')}</p>
			<dl>
				<dt>{t('packs.review.name')}</dt>
				<dd>{staged.manifest.name}</dd>
				<dt>{t('packs.review.id')}</dt>
				<dd><code>{staged.manifest.id}</code></dd>
				<dt>{t('packs.review.version')}</dt>
				<dd>{staged.manifest.version}</dd>
				<dt>{t('packs.review.type')}</dt>
				<dd>{staged.manifest.type}</dd>
				{#if staged.manifest.languages?.length}
					<dt>{t('packs.review.languages')}</dt>
					<dd>{staged.manifest.languages.map((l) => languageLabel(l)).join(', ')}</dd>
				{:else if staged.manifest.language}
					<dt>{t('packs.review.language')}</dt>
					<dd>{languageLabel(staged.manifest.language)}</dd>
				{/if}
				<dt>{licenceLabel()}</dt>
				<dd class="licence">{staged.manifest.license}</dd>
				<dt>{t('packs.review.attribution')}</dt>
				<dd>{staged.manifest.attribution}</dd>
				{#if staged.manifest.notice}
					<dt>{t('packs.review.notice')}</dt>
					<dd class="notice-text">{staged.manifest.notice}</dd>
				{/if}
			</dl>
			{#if staged.themes?.length}
				<!-- A theme pack: the measured contrast of every theme (reported, never enforced). -->
				<div class="contrast">
					<h4>{t('packs.contrast.title')}</h4>
					<p>{contrastSummary(staged.themes)}</p>
					{#each staged.themes as theme (theme.id)}
						{@const view = contrastView(theme)}
						<div class="table-wrap">
							<table>
								<caption>{view.caption}</caption>
								<thead>
									<tr>
										<th scope="col">{t('packs.contrast.col.pair')}</th>
										<th scope="col">{t('packs.contrast.col.ratio')}</th>
										<th scope="col">{t('packs.contrast.col.needed')}</th>
										<th scope="col">{t('packs.contrast.col.result')}</th>
									</tr>
								</thead>
								<tbody>
									{#each view.rows as row, i (i)}
										<tr class:below={!row.pass}>
											<th scope="row">{row.pair}</th>
											<td>{row.ratio}</td>
											<td>{row.needed}</td>
											<td class="result">{row.result}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/each}
				</div>
			{/if}
			{#if caution}
				<p class="caution" role="note">{caution}</p>
			{/if}
			{#if replaces.length > 0}
				<ul class="replaces">
					{#each replaces as line (line.text)}
						<li class:changed={line.licenceChanged}>{line.text}</li>
					{/each}
				</ul>
			{/if}
			<label class="confirm">
				<input type="checkbox" bind:checked={confirmed} disabled={phase !== 'review'} />
				<span>{licenceConfirmation()}</span>
			</label>
			<div class="actions">
				<button type="button" onclick={install} disabled={!confirmed || phase !== 'review'}>{t('packs.review.install')}</button>
				<button type="button" onclick={discard} disabled={phase !== 'review'}>{t('packs.review.discard')}</button>
			</div>
			{#if phase === 'importing'}
				<div class="progress" role="status">
					<p>{t('packs.review.importing')}</p>
					<progress aria-label={t('packs.review.importingLabel')}></progress>
				</div>
			{/if}
		</div>
	{/if}

	{#if notice}
		<p class="notice" role="status">{notice}</p>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if catalogue?.building}
		<p class="notice" role="status">{packagesBuilding()}</p>
	{:else if catalogueFailed}
		<p class="hint">{packagesUnavailable()}</p>
	{/if}

	{#if loading}
		<p>{t('packs.list.loading')}</p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
		<button type="button" onclick={load}>{t('packs.list.retry')}</button>
	{:else if packs.length === 0}
		<p>
			<Msg key="packs.list.none">{#snippet code(text: string)}<code>{text}</code>{/snippet}</Msg>
		</p>
	{:else}
		{#each groups as group (group.type)}
			<h3>{group.label}</h3>
			<ul class="pack-list">
				{#each group.packs as pack (pack.packId)}
					{@const lic = licenceLine(pack.license)}
					<li>
						<div class="pack-head">
							<strong>{pack.name || pack.packId}</strong>
							<code>{pack.packId}</code>
							{#each packLanguages(pack) as lang (lang)}<span>{languageLabel(lang)}</span>{/each}
							{#if pack.version}<span>{pack.version}</span>{/if}
							{#if pack.updatedAt}<span>{fmtDate(pack.updatedAt)}</span>{/if}
						</div>
						<p class:unrecorded={!lic.recorded}>
							{#if lic.recorded}<span class="label">{t('packs.list.licence', { label: licenceLabel() })}</span> {/if}{lic.text}
						</p>
						{#if pack.attribution}
							<p><span class="label">{t('packs.list.attribution')}</span> {pack.attribution}</p>
						{/if}
						{#each packagesOf(pack, catalogue?.packages ?? []) as row (row.id)}
							{@const line = packageLine(row)}
							<p class="package"><span class="label">{t('packs.list.package')}</span> {line.text}</p>
							{#if line.error}<p class="error package-error">{t('packs.list.buildFailed', { error: line.error })}</p>{/if}
						{/each}
						<button type="button" class="uninstall" onclick={() => askUninstall(pack)}>
							{t('packs.list.uninstall')}<span class="sr"> {pack.name || pack.packId}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/each}
	{/if}

	<p><a href="/sources">{t('packs.list.sources')}</a></p>

	<dialog bind:this={dialog} aria-labelledby="uninstall-heading" onclose={() => (pending = null)}>
		{#if pending}
			<h3 id="uninstall-heading">{t('packs.uninstallDialog.title', { name: pending.name || pending.packId })}</h3>
			<p>{uninstallWarning(pending.type)}</p>
			<div class="actions">
				<button type="button" onclick={confirmUninstall} disabled={uninstalling}>
					{uninstalling ? t('packs.uninstallDialog.uninstalling') : t('packs.list.uninstall')}
				</button>
				<button type="button" onclick={closeDialog} disabled={uninstalling}>{t('common.action.cancel')}</button>
			</div>
		{/if}
	</dialog>
</section>

<style>
	.packs button,
	.packs input[type='file'] {
		min-height: 2.75rem;
	}
	.install {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.5rem 0.75rem;
		margin: 1rem 0;
	}
	.file {
		display: grid;
		gap: 0.25rem;
	}
	.progress {
		display: grid;
		gap: 0.4rem;
		margin: 0.75rem 0;
	}
	.progress progress {
		width: 100%;
		max-width: 28rem;
	}
	.review,
	.pack-list li {
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
		padding: 0.6rem 0.75rem;
	}
	.review {
		margin: 1rem 0;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
		margin: 0.5rem 0;
	}
	dt {
		font-weight: 600;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.licence {
		font-weight: 600;
	}
	.notice-text {
		white-space: pre-line;
	}
	.caution {
		border-left: 4px solid #b45309;
		padding: 0.4rem 0.75rem;
		font-weight: 600;
	}
	.replaces {
		margin: 0.5rem 0;
		padding-left: 1.2rem;
	}
	.replaces .changed {
		font-weight: 700;
		text-decoration: underline;
	}
	.confirm {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		margin: 0.75rem 0;
	}
	.confirm input {
		width: 1.4rem;
		height: 1.4rem;
		flex: none;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.pack-list {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.pack-list p {
		margin: 0.25rem 0;
	}
	.pack-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
	}
	.label {
		opacity: 0.75;
	}
	.unrecorded {
		font-style: italic;
	}
	.hint {
		opacity: 0.75;
	}
	.error {
		color: #b42318;
	}
	@media (prefers-color-scheme: dark) {
		.error {
			color: #ff8a80;
		}
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	dialog {
		max-width: min(32rem, 92vw);
	}
	/* The contrast tables of a staged theme pack: the result is a word;
	   a row below its minimum is also bold (never colour alone). */
	.contrast h4 {
		margin: 1rem 0 0.25rem;
	}
	.contrast .table-wrap {
		overflow-x: auto;
		margin-block: 0.5rem;
	}
	.contrast table {
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	.contrast caption {
		text-align: start;
		font-weight: 600;
		padding-bottom: 0.25rem;
	}
	.contrast th,
	.contrast td {
		text-align: start;
		padding: 0.2rem 0.75rem 0.2rem 0;
		border-bottom: 1px solid var(--hair);
	}
	.contrast tr.below .result {
		font-weight: 700;
	}
</style>
