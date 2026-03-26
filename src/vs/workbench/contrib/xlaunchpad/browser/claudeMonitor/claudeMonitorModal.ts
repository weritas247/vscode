/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './claudeMonitorModal.css';
import { $, clearNode } from '../../../../../base/browser/dom.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { XLaunchpadModal, IXLaunchpadTab } from '../modal/xlaunchpadModal.js';
import { XLaunchpadModalId } from '../../common/xlaunchpad.js';
import { IClaudeProjectUsage } from '../../common/claudeMonitor.js';
import { ClaudeMonitorDataService } from './claudeMonitorDataService.js';

export class ClaudeMonitorModal extends XLaunchpadModal {

	private dataService: ClaudeMonitorDataService;

	constructor(
		@ILayoutService layoutService: ILayoutService,
		@IStorageService storageService: IStorageService,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(
			XLaunchpadModalId.ClaudeMonitor,
			'Claude Monitor',
			800, 500,
			400, 300,
			false,
			layoutService,
			storageService,
		);
		this.dataService = instantiationService.createInstance(ClaudeMonitorDataService);
	}

	protected getTabs(): IXLaunchpadTab[] {
		return [
			{ id: 'overview', label: 'Overview' },
		];
	}

	protected renderTabContent(tabId: string, container: HTMLElement): void {
		if (tabId === 'overview') {
			this.renderOverview(container);
		}
	}

	protected onTabChanged(_tabId: string): void {
		// Single tab, nothing to do
	}

	private async renderOverview(container: HTMLElement): Promise<void> {
		// Show loading
		const loading = container.appendChild($('.claude-monitor-empty'));
		loading.appendChild($('.claude-monitor-empty-icon')).textContent = '\u2699'; // ⚙
		loading.appendChild($('.claude-monitor-empty-text')).textContent = 'Loading usage data...';

		let projects: IClaudeProjectUsage[];
		try {
			projects = await this.dataService.getUsageSummary();
		} catch {
			clearNode(container);
			this.renderEmpty(container, 'Failed to read Claude data');
			return;
		}

		clearNode(container);

		if (projects.length === 0) {
			this.renderEmpty(container, 'No Claude usage data found');
			return;
		}

		// Aggregate totals
		const totalInput = projects.reduce((s, p) => s + p.totalInputTokens, 0);
		const totalOutput = projects.reduce((s, p) => s + p.totalOutputTokens, 0);
		const totalCost = projects.reduce((s, p) => s + p.totalCost, 0);
		const totalSessions = projects.reduce((s, p) => s + p.sessions.length, 0);

		// Summary cards
		const summary = container.appendChild($('.claude-monitor-summary'));
		this.renderCard(summary, 'Total Cost', `$${totalCost.toFixed(2)}`, `${totalSessions} sessions`);
		this.renderCard(summary, 'Input Tokens', this.formatTokens(totalInput), '');
		this.renderCard(summary, 'Output Tokens', this.formatTokens(totalOutput), '');
		this.renderCard(summary, 'Projects', String(projects.length), '');

		// Projects table
		const tableSection = container.appendChild($('.claude-monitor-projects'));
		tableSection.appendChild($('.claude-monitor-projects-title')).textContent = 'Usage by Project';

		const table = tableSection.appendChild($('table.claude-monitor-table'));

		// Header
		const thead = table.appendChild($('thead'));
		const headerRow = thead.appendChild($('tr'));
		for (const label of ['Project', 'Sessions', 'Input', 'Output', 'Cost']) {
			const th = headerRow.appendChild($('th'));
			th.textContent = label;
			if (label !== 'Project') {
				th.style.textAlign = 'right';
			}
		}

		// Body
		const tbody = table.appendChild($('tbody'));
		for (const project of projects) {
			const row = tbody.appendChild($('tr'));

			// Project name
			const nameCell = row.appendChild($('td.project-name'));
			nameCell.textContent = this.formatProjectName(project.projectPath);
			nameCell.title = project.projectPath;

			// Sessions count
			const sessCell = row.appendChild($('td.num'));
			sessCell.textContent = String(project.sessions.length);

			// Input tokens
			const inputCell = row.appendChild($('td.num'));
			inputCell.textContent = this.formatTokens(project.totalInputTokens);

			// Output tokens
			const outputCell = row.appendChild($('td.num'));
			outputCell.textContent = this.formatTokens(project.totalOutputTokens);

			// Cost
			const costCell = row.appendChild($('td.num.cost'));
			costCell.textContent = `$${project.totalCost.toFixed(2)}`;

			// Expandable session details on click
			row.style.cursor = 'pointer';
			let expanded = false;
			let detailRows: HTMLElement[] = [];

			row.addEventListener('click', () => {
				if (expanded) {
					for (const dr of detailRows) {
						dr.remove();
					}
					detailRows = [];
					expanded = false;
				} else {
					for (const session of project.sessions) {
						const detailRow = document.createElement('tr');
						detailRow.className = 'claude-monitor-session-detail';
						clearNode(detailRow);

						const modelCell = detailRow.appendChild($('td')) as HTMLTableCellElement;
						modelCell.colSpan = 1;
						modelCell.style.paddingLeft = '24px';
						const badge = modelCell.appendChild($('span.claude-monitor-session-model'));
						badge.textContent = this.shortModelName(session.model);

						const sidCell = detailRow.appendChild($('td.num'));
						sidCell.textContent = session.sessionId.substring(0, 8) + '...';
						sidCell.title = session.sessionId;
						sidCell.style.fontSize = '11px';

						const inCell = detailRow.appendChild($('td.num'));
						inCell.textContent = this.formatTokens(session.inputTokens);
						inCell.style.fontSize = '11px';

						const outCell = detailRow.appendChild($('td.num'));
						outCell.textContent = this.formatTokens(session.outputTokens);
						outCell.style.fontSize = '11px';

						const cCell = detailRow.appendChild($('td.num.cost'));
						cCell.textContent = `$${session.cost.toFixed(4)}`;
						cCell.style.fontSize = '11px';

						row.after(detailRow);
						detailRows.push(detailRow);
					}
					// Reverse so they appear in order after the row
					detailRows.reverse();
					expanded = true;
				}
			});
		}
	}

	private renderCard(parent: HTMLElement, label: string, value: string, sub: string): void {
		const card = parent.appendChild($('.claude-monitor-card'));
		card.appendChild($('.claude-monitor-card-label')).textContent = label;
		card.appendChild($('.claude-monitor-card-value')).textContent = value;
		if (sub) {
			card.appendChild($('.claude-monitor-card-sub')).textContent = sub;
		}
	}

	private renderEmpty(container: HTMLElement, message: string): void {
		const empty = container.appendChild($('.claude-monitor-empty'));
		empty.appendChild($('.claude-monitor-empty-icon')).textContent = '\u2728'; // ✨
		empty.appendChild($('.claude-monitor-empty-text')).textContent = message;
		empty.appendChild($('.claude-monitor-empty-hint')).textContent = 'Claude usage data is stored in ~/.claude/projects/';
	}

	private formatTokens(count: number): string {
		if (count >= 1_000_000) {
			return `${(count / 1_000_000).toFixed(1)}M`;
		}
		if (count >= 1_000) {
			return `${(count / 1_000).toFixed(1)}K`;
		}
		return String(count);
	}

	private formatProjectName(raw: string): string {
		// Project dirs are like "-Users-john-dev-myproject" → convert back
		return raw.replace(/^-/, '/').replace(/-/g, '/');
	}

	private shortModelName(model: string): string {
		if (model.includes('opus')) {
			return 'Opus';
		}
		if (model.includes('sonnet')) {
			return 'Sonnet';
		}
		if (model.includes('haiku')) {
			return 'Haiku';
		}
		return model.split('-').slice(0, 2).join('-');
	}
}
