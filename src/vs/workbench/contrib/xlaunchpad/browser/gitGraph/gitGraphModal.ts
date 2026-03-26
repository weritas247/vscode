/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './gitGraphModal.css';
import { $, clearNode } from '../../../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../../../base/browser/mouseEvent.js';
import { createTrustedTypesPolicy } from '../../../../../base/browser/trustedTypes.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { Action, Separator } from '../../../../../base/common/actions.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { URI } from '../../../../../base/common/uri.js';
import { XLaunchpadModal, IXLaunchpadTab } from '../modal/xlaunchpadModal.js';
import { XLaunchpadModalId } from '../../common/xlaunchpad.js';
import { GitGraphDataService, ICommitEntry, IGitStatusFile } from './gitGraphDataService.js';

const ttPolicy = createTrustedTypesPolicy('gitGraphModal', { createHTML: value => value });

export class GitGraphModal extends XLaunchpadModal {

	private static readonly PAGE_SIZE = 20;

	private dataService: GitGraphDataService;
	private commits: ICommitEntry[] = [];
	private selectedHash: string | undefined;
	private focusedIdx = -1;
	private searchQuery = '';
	private hasMore = false;
	private isLoadingMore = false;

	constructor(
		@ILayoutService layoutService: ILayoutService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super(
			XLaunchpadModalId.GitGraph,
			'Git Graph',
			960, 640,
			480, 320,
			layoutService,
			storageService,
		);
		this.dataService = instantiationService.createInstance(GitGraphDataService);
	}

	protected getTabs(): IXLaunchpadTab[] {
		return [
			{ id: 'branch', label: 'Branch' },
			{ id: 'status', label: 'Git Status' },
		];
	}

	protected renderTabContent(tabId: string, container: HTMLElement): void {
		if (tabId === 'branch') {
			this.renderBranchTab(container);
		} else if (tabId === 'status') {
			this.renderStatusTab(container);
		}
	}

	protected onTabChanged(_tabId: string): void {
		this.selectedHash = undefined;
		this.focusedIdx = -1;
	}

	protected override renderTitlebarActions(container: HTMLElement): void {
		// Repo name
		const repoName = this.dataService.getRepoName();
		if (repoName) {
			const nameEl = container.appendChild($('.gg-toolbar-repo'));
			nameEl.textContent = repoName;
		}

		// Current branch badge (loaded async)
		const branchBadge = container.appendChild($('.gg-toolbar-branch'));
		branchBadge.textContent = '...';
		this.dataService.getCurrentBranch().then(branch => {
			branchBadge.textContent = branch || 'HEAD';
		});

		// Separator
		container.appendChild($('.gg-toolbar-sep'));

		// Pull
		const pullBtn = container.appendChild($('.gg-toolbar-btn'));
		pullBtn.textContent = '\u2193 Pull';
		pullBtn.title = 'Git Pull';
		pullBtn.addEventListener('click', async () => {
			try {
				await this.dataService.gitPull();
				this.notificationService.info('Pull completed');
			} catch (e) {
				this.notificationService.error(`Pull failed: ${e}`);
			}
		});

		// Push
		const pushBtn = container.appendChild($('.gg-toolbar-btn'));
		pushBtn.textContent = '\u2191 Push';
		pushBtn.title = 'Git Push';
		pushBtn.addEventListener('click', async () => {
			try {
				await this.dataService.gitPush();
				this.notificationService.info('Push completed');
			} catch (e) {
				this.notificationService.error(`Push failed: ${e}`);
			}
		});

		// GitHub link
		const ghBtn = container.appendChild($('.gg-toolbar-btn'));
		ghBtn.textContent = 'GitHub \u2197';
		ghBtn.title = 'Open on GitHub';
		ghBtn.addEventListener('click', async () => {
			const url = await this.dataService.getRemoteUrl();
			if (url) {
				await this.openerService.open(URI.parse(url));
			} else {
				this.notificationService.info('No remote origin URL found');
			}
		});
	}

	// ─── Branch Tab ─────────────────────────────────────

	private async renderBranchTab(container: HTMLElement): Promise<void> {
		// Search bar
		const searchBar = container.appendChild($('.gg-search-bar'));
		const searchInput = searchBar.appendChild($('input.gg-search-input')) as HTMLInputElement;
		searchInput.placeholder = 'Search commits...';
		searchInput.value = this.searchQuery;

		let searchTimeout: ReturnType<typeof setTimeout> | undefined;
		searchInput.addEventListener('input', () => {
			clearTimeout(searchTimeout);
			searchTimeout = setTimeout(() => {
				this.searchQuery = searchInput.value;
				this.renderCommitGraph(graphContainer, this.filterCommits());
			}, 200);
		});

		// Graph container
		const graphContainer = container.appendChild($('.git-graph-container'));
		const loading = graphContainer.appendChild($('.git-graph-loading'));
		loading.textContent = 'Loading commits...';

		// Keyboard navigation
		container.tabIndex = 0;
		container.addEventListener('keydown', (e) => {
			const event = new StandardKeyboardEvent(e);
			const rows = graphContainer.querySelectorAll('.gg-row');
			if (event.keyCode === KeyCode.DownArrow) {
				e.preventDefault();
				this.focusedIdx = Math.min(this.focusedIdx + 1, rows.length - 1);
				this.updateFocus(graphContainer);
			} else if (event.keyCode === KeyCode.UpArrow) {
				e.preventDefault();
				this.focusedIdx = Math.max(this.focusedIdx - 1, 0);
				this.updateFocus(graphContainer);
			} else if (event.keyCode === KeyCode.Enter && this.focusedIdx >= 0) {
				e.preventDefault();
				const filtered = this.filterCommits();
				if (filtered[this.focusedIdx]) {
					this.toggleCommitDetail(graphContainer, filtered[this.focusedIdx]);
				}
			}
		});

		// Load initial page
		try {
			const result = await this.dataService.getCommits(GitGraphModal.PAGE_SIZE);
			this.commits = result.commits;
			this.hasMore = result.hasMore;
			clearNode(graphContainer);

			if (this.commits.length === 0) {
				const empty = graphContainer.appendChild($('.git-graph-empty'));
				empty.appendChild($('.git-graph-empty-icon')).textContent = '\u{1F4CB}';
				empty.appendChild($('div')).textContent = 'No commits found';
				return;
			}

			this.renderCommitGraph(graphContainer, this.commits);

			// Infinite scroll
			const scrollEl = graphContainer.querySelector('.git-graph-scroll');
			if (scrollEl) {
				scrollEl.addEventListener('scroll', () => {
					if (this.isLoadingMore || !this.hasMore || this.searchQuery) {
						return;
					}
					const el = scrollEl as HTMLElement;
					if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
						this.loadMoreCommits(graphContainer);
					}
				});
			}

			container.focus();
		} catch {
			clearNode(graphContainer);
			const empty = graphContainer.appendChild($('.git-graph-empty'));
			empty.appendChild($('.git-graph-empty-icon')).textContent = '\u26A0';
			empty.appendChild($('div')).textContent = 'Failed to load git log';
		}
	}

	private async loadMoreCommits(graphContainer: HTMLElement): Promise<void> {
		this.isLoadingMore = true;

		try {
			const result = await this.dataService.getCommits(GitGraphModal.PAGE_SIZE, this.commits.length);
			this.hasMore = result.hasMore;

			if (result.commits.length === 0) {
				return;
			}

			this.commits.push(...result.commits);
			// Re-render with all commits (graph layout depends on full history)
			this.renderCommitGraph(graphContainer, this.filterCommits());
		} finally {
			this.isLoadingMore = false;
		}
	}

	private filterCommits(): ICommitEntry[] {
		if (!this.searchQuery) {
			return this.commits;
		}
		const q = this.searchQuery.toLowerCase();
		return this.commits.filter(c =>
			c.message.toLowerCase().includes(q) ||
			c.author.toLowerCase().includes(q) ||
			c.hash.toLowerCase().startsWith(q)
		);
	}

	private renderCommitGraph(container: HTMLElement, commits: ICommitEntry[]): void {
		clearNode(container);

		const scroll = container.appendChild($('.git-graph-scroll'));
		const { positions, svgWidth } = this.dataService.computeLayout(commits);
		const totalHeight = commits.length * GitGraphDataService.ROW_H;

		// SVG graph
		const svgCol = scroll.appendChild($('.git-graph-svg-col'));
		const svgHtml = this.dataService.buildSvg(commits, positions, svgWidth, totalHeight);
		svgCol.innerHTML = (ttPolicy?.createHTML(svgHtml) ?? svgHtml) as string;

		// Commit rows
		const commitsEl = scroll.appendChild($('.git-graph-commits'));
		commitsEl.style.paddingLeft = `${svgWidth + 4}px`;

		for (let i = 0; i < commits.length; i++) {
			const c = commits[i];
			const row = commitsEl.appendChild($('.gg-row'));
			row.style.height = `${GitGraphDataService.ROW_H}px`;
			row.dataset.hash = c.hash;
			row.dataset.index = String(i);

			if (c.hash === this.selectedHash) {
				row.classList.add('selected');
			}

			// Refs
			const msg = row.appendChild($('.gg-msg'));
			if (c.refs.length > 0) {
				for (const ref of c.refs) {
					const badge = msg.appendChild($('.gg-ref'));
					if (ref.startsWith('HEAD')) {
						badge.classList.add('head');
					} else if (ref.startsWith('tag:')) {
						badge.classList.add('tag');
					} else {
						badge.classList.add('branch');
					}
					badge.textContent = ref.replace('tag: ', '');
				}
			}
			const msgText = document.createTextNode(' ' + c.message);
			msg.appendChild(msgText);

			// Author
			row.appendChild($('.gg-author')).textContent = c.author;

			// Hash
			const hashEl = row.appendChild($('.gg-hash'));
			hashEl.textContent = c.hash.slice(0, 7);
			hashEl.title = c.hash;

			// Time
			row.appendChild($('.gg-time')).textContent = this.formatTime(c.date);

			// Click
			row.addEventListener('click', () => {
				this.focusedIdx = i;
				this.toggleCommitDetail(container, c);
				this.updateSelection(container);
			});

			// Right-click context menu
			row.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.showCommitContextMenu(e, c);
			});
		}
	}

	private showCommitContextMenu(e: MouseEvent, commit: ICommitEntry): void {
		const anchor = new StandardMouseEvent(window, e);
		const cmd = this.dataService.commandService;

		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			layer: 100,
			getActions: () => [
				new Action('gitGraph.cherryPick', 'Cherry Pick', undefined, true, () => cmd.executeCommand('git.cherryPick', commit.hash)),
				new Action('gitGraph.revert', 'Revert', undefined, true, () => cmd.executeCommand('git.revert', commit.hash)),
				new Separator(),
				new Action('gitGraph.merge', 'Merge into Current Branch', undefined, true, () => cmd.executeCommand('git.merge', commit.hash)),
				new Action('gitGraph.rebase', 'Rebase Current Branch on This Commit', undefined, true, () => cmd.executeCommand('git.rebase', commit.hash)),
				new Separator(),
				new Action('gitGraph.copyHash', 'Copy Commit Hash', undefined, true, async () => {
					await this.clipboardService.writeText(commit.hash);
					this.notificationService.info(`Copied: ${commit.hash.slice(0, 7)}`);
				}),
				new Action('gitGraph.copySubject', 'Copy Commit Subject', undefined, true, async () => {
					await this.clipboardService.writeText(commit.message);
				}),
			],
		});
	}

	private toggleCommitDetail(container: HTMLElement, commit: ICommitEntry): void {
		const existing = container.querySelector(`.gg-detail[data-hash="${commit.hash}"]`);
		if (existing) {
			existing.remove();
			this.selectedHash = undefined;
			this.updateSelection(container);
			return;
		}

		// Remove any other detail
		container.querySelectorAll('.gg-detail').forEach(el => el.remove());
		this.selectedHash = commit.hash;
		this.updateSelection(container);

		// Find the row and insert detail after it
		const row = container.querySelector(`.gg-row[data-hash="${commit.hash}"]`);
		if (!row) {
			return;
		}

		const detail = document.createElement('div');
		detail.className = 'gg-detail';
		detail.dataset.hash = commit.hash;

		// Two-column layout
		const left = detail.appendChild($('.gg-detail-left'));
		const right = detail.appendChild($('.gg-detail-right'));

		// ─── Left: Commit info ───
		const addRow = (label: string, valueEl: HTMLElement) => {
			const row = left.appendChild($('.gg-detail-row'));
			row.appendChild($('.gg-detail-label')).textContent = label;
			row.appendChild(valueEl);
		};

		// COMMIT
		const commitVal = $('span.gg-detail-hash');
		commitVal.textContent = commit.hash.slice(0, 7);
		addRow('COMMIT', commitVal);

		// PARENTS
		if (commit.parents.length > 0) {
			const parentsVal = $('span');
			for (const ph of commit.parents) {
				const span = parentsVal.appendChild($('span.gg-detail-hash'));
				span.textContent = ph.slice(0, 7);
				parentsVal.appendChild(document.createTextNode(' '));
			}
			addRow('PARENTS', parentsVal);
		}

		// AUTHOR
		const authorVal = $('span');
		authorVal.textContent = commit.authorEmail
			? `${commit.author} <${commit.authorEmail}>`
			: commit.author;
		addRow('AUTHOR', authorVal);

		// DATE
		const dateVal = $('span');
		const d = new Date(commit.date);
		dateVal.textContent = d.toLocaleString('en', {
			year: 'numeric', month: 'short', day: 'numeric',
			hour: '2-digit', minute: '2-digit', second: '2-digit',
		});
		addRow('DATE', dateVal);

		// MESSAGE
		const msgVal = $('span.gg-detail-message');
		const fullMsg = commit.body || commit.message;
		msgVal.textContent = fullMsg;
		addRow('MESSAGE', msgVal);

		// ─── Right: Changed files (loaded async) ───
		const filesHeader = right.appendChild($('.gg-detail-files-header'));
		filesHeader.textContent = 'CHANGED FILES';

		const filesList = right.appendChild($('.gg-detail-files-list'));
		filesList.textContent = 'Loading...';

		this.loadChangedFiles(commit, filesList, filesHeader);

		row.after(detail);
	}

	private async loadChangedFiles(commit: ICommitEntry, filesList: HTMLElement, filesHeader: HTMLElement): Promise<void> {
		try {
			const files = await this.dataService.getChangedFiles(commit);
			clearNode(filesList);

			filesHeader.textContent = `CHANGED FILES (${files.length})`;

			for (const file of files) {
				const item = filesList.appendChild($('.gg-detail-file'));

				const badge = item.appendChild($('.gg-detail-file-badge'));
				badge.textContent = file.status;
				badge.classList.add(file.status);

				const path = item.appendChild($('.gg-detail-file-path'));
				path.textContent = file.path;
				path.title = file.path;

				if (file.additions > 0 || file.deletions > 0) {
					const stats = item.appendChild($('.gg-detail-file-stats'));
					if (file.additions > 0) {
						stats.appendChild($('span.add')).textContent = `+${file.additions}`;
					}
					if (file.deletions > 0) {
						stats.appendChild($('span.del')).textContent = `-${file.deletions}`;
					}
				}
			}

			if (files.length === 0) {
				filesList.textContent = '(no changed files)';
			}
		} catch {
			filesList.textContent = '(failed to load)';
		}
	}

	private updateSelection(container: HTMLElement): void {
		container.querySelectorAll('.gg-row').forEach(el => {
			(el as HTMLElement).classList.toggle('selected', (el as HTMLElement).dataset.hash === this.selectedHash);
		});
	}

	private updateFocus(container: HTMLElement): void {
		const rows = container.querySelectorAll('.gg-row');
		rows.forEach((el, i) => {
			(el as HTMLElement).classList.toggle('focused', i === this.focusedIdx);
		});
		if (rows[this.focusedIdx]) {
			(rows[this.focusedIdx] as HTMLElement).scrollIntoView({ block: 'nearest' });
		}
	}

	// ─── Status Tab ─────────────────────────────────────

	private async renderStatusTab(container: HTMLElement): Promise<void> {
		const statusContainer = container.appendChild($('.git-status-container'));
		statusContainer.style.height = '100%';

		const filesPane = statusContainer.appendChild($('.git-status-files'));
		const diffPane = statusContainer.appendChild($('.git-status-diff'));
		diffPane.textContent = 'Select a file to view diff';

		// Loading
		filesPane.textContent = 'Loading...';

		try {
			const files = await this.dataService.getStatus();
			clearNode(filesPane);

			if (files.length === 0) {
				filesPane.appendChild($('div')).textContent = 'Working tree clean';
				filesPane.style.padding = '24px';
				filesPane.style.color = 'var(--vscode-descriptionForeground)';
				return;
			}

			const staged = files.filter(f => f.staged);
			const unstaged = files.filter(f => !f.staged);

			if (staged.length > 0) {
				this.renderStatusGroup(filesPane, 'Staged', staged, diffPane);
			}
			if (unstaged.length > 0) {
				this.renderStatusGroup(filesPane, 'Changes', unstaged, diffPane);
			}

			// Update tab badge
			this.updateTabBadge('status', files.length);
		} catch {
			clearNode(filesPane);
			filesPane.appendChild($('div')).textContent = 'Failed to load git status';
		}
	}

	private renderStatusGroup(parent: HTMLElement, label: string, files: IGitStatusFile[], diffPane: HTMLElement): void {
		const group = parent.appendChild($('.git-status-group'));
		const header = group.appendChild($('.git-status-group-header'));
		header.textContent = `${label} (${files.length})`;

		for (const file of files) {
			const item = group.appendChild($('.git-status-file'));

			const badge = item.appendChild($('.git-status-badge'));
			badge.textContent = file.status;
			badge.classList.add(file.status);

			const pathEl = item.appendChild($('.git-status-path'));
			pathEl.textContent = file.path;
			pathEl.title = file.path;

			item.addEventListener('click', async () => {
				// Update selection
				parent.querySelectorAll('.git-status-file').forEach(el => el.classList.remove('active'));
				item.classList.add('active');
				// Load diff
				diffPane.textContent = 'Loading diff...';
				try {
					const diff = await this.dataService.getDiff(file.path);
					clearNode(diffPane);
					if (diff) {
						this.renderDiff(diffPane, diff);
					} else {
						diffPane.textContent = '(no diff available)';
					}
				} catch {
					diffPane.textContent = '(failed to load diff)';
				}
			});
		}
	}

	private renderDiff(container: HTMLElement, diff: string): void {
		for (const line of diff.split('\n')) {
			const el = container.appendChild($('div'));
			if (line.startsWith('+') && !line.startsWith('+++')) {
				el.className = 'diff-add';
			} else if (line.startsWith('-') && !line.startsWith('---')) {
				el.className = 'diff-del';
			} else if (line.startsWith('@@')) {
				el.className = 'diff-hunk';
			}
			el.textContent = line;
		}
	}

	// ─── Helpers ────────────────────────────────────────

	private formatTime(dateStr: string): string {
		const d = new Date(dateStr);
		const now = Date.now();
		const diff = now - d.getTime();

		if (diff < 60_000) {
			return 'just now';
		}
		if (diff < 3_600_000) {
			return `${Math.floor(diff / 60_000)}m ago`;
		}
		if (diff < 86_400_000) {
			return `${Math.floor(diff / 3_600_000)}h ago`;
		}
		if (diff < 604_800_000) {
			return `${Math.floor(diff / 86_400_000)}d ago`;
		}

		const month = d.toLocaleString('en', { month: 'short' });
		return `${month} ${d.getDate()}`;
	}
}
