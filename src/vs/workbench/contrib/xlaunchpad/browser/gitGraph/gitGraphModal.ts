/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './gitGraphModal.css';
import { $, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { XLaunchpadModal, IXLaunchpadTab } from '../modal/xlaunchpadModal.js';
import { XLaunchpadModalId } from '../../common/xlaunchpad.js';
import { GitGraphDataService, ICommitEntry, IGitStatusFile } from './gitGraphDataService.js';

export class GitGraphModal extends XLaunchpadModal {

	private dataService: GitGraphDataService;
	private commits: ICommitEntry[] = [];
	private selectedHash: string | undefined;
	private focusedIdx = -1;
	private searchQuery = '';
	private selectedStatusFile: string | undefined;

	constructor(
		@ILayoutService layoutService: ILayoutService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
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

		// Load data
		try {
			const { commits } = await this.dataService.getCommits(200);
			this.commits = commits;
			graphContainer.innerHTML = '';

			if (commits.length === 0) {
				const empty = graphContainer.appendChild($('.git-graph-empty'));
				empty.appendChild($('.git-graph-empty-icon')).textContent = '\u{1F4CB}';
				empty.appendChild($('div')).textContent = 'No commits found';
				return;
			}

			this.renderCommitGraph(graphContainer, commits);
			container.focus();
		} catch {
			graphContainer.innerHTML = '';
			const empty = graphContainer.appendChild($('.git-graph-empty'));
			empty.appendChild($('.git-graph-empty-icon')).textContent = '\u26A0';
			empty.appendChild($('div')).textContent = 'Failed to load git log';
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
		container.innerHTML = '';

		const scroll = container.appendChild($('.git-graph-scroll'));
		const { positions, svgWidth } = this.dataService.computeLayout(commits);
		const totalHeight = commits.length * GitGraphDataService.ROW_H;

		// SVG graph
		const svgCol = scroll.appendChild($('.git-graph-svg-col'));
		svgCol.innerHTML = this.dataService.buildSvg(commits, positions, svgWidth, totalHeight);

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
		}
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

		// Stats
		const stats = detail.appendChild($('.gg-detail-stats'));
		if (commit.additions > 0 || commit.deletions > 0) {
			const addStat = stats.appendChild($('.gg-detail-stat.add'));
			addStat.textContent = `+${commit.additions}`;
			const delStat = stats.appendChild($('.gg-detail-stat.del'));
			delStat.textContent = `-${commit.deletions}`;
		}

		// Full hash
		const hashLine = detail.appendChild($('div'));
		hashLine.style.fontFamily = 'var(--monaco-monospace-font, monospace)';
		hashLine.textContent = commit.hash;

		// Parents
		if (commit.parents.length > 0) {
			const parents = detail.appendChild($('.gg-detail-parents'));
			parents.textContent = 'Parents: ';
			for (const ph of commit.parents) {
				const span = parents.appendChild($('.gg-detail-parent-hash'));
				span.textContent = ph.slice(0, 7) + ' ';
			}
		}

		// Author + Date
		const info = detail.appendChild($('div'));
		info.textContent = `${commit.author} \u2022 ${new Date(commit.date).toLocaleString()}`;

		row.after(detail);
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
			filesPane.innerHTML = '';

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
			filesPane.innerHTML = '';
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

			const path = item.appendChild($('.git-status-path'));
			path.textContent = file.path;
			path.title = file.path;

			item.addEventListener('click', async () => {
				// Update selection
				parent.querySelectorAll('.git-status-file').forEach(el => el.classList.remove('active'));
				item.classList.add('active');
				this.selectedStatusFile = file.path;

				// Load diff
				diffPane.textContent = 'Loading diff...';
				const diff = await this.dataService.getDiff(file.path, file.staged);
				diffPane.innerHTML = '';
				if (diff) {
					this.renderDiff(diffPane, diff);
				} else {
					diffPane.textContent = '(no diff available)';
				}
			});
		}
	}

	private renderDiff(container: HTMLElement, diff: string): void {
		const lines = diff.split('\n');
		for (const line of lines) {
			const el = document.createElement('div');
			if (line.startsWith('+') && !line.startsWith('+++')) {
				el.className = 'diff-add';
			} else if (line.startsWith('-') && !line.startsWith('---')) {
				el.className = 'diff-del';
			} else if (line.startsWith('@@')) {
				el.className = 'diff-hunk';
			}
			el.textContent = line;
			container.appendChild(el);
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
