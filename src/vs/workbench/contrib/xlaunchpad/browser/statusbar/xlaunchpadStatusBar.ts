/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';
import { IClaudeTerminalService } from '../../common/xlaunchpad.js';

export class XLaunchpadStatusBarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.xlaunchpadStatusBar';

	private readonly _claudeEntry: IStatusbarEntryAccessor;

	constructor(
		@IStatusbarService statusbarService: IStatusbarService,
		@IClaudeTerminalService private readonly _claudeTerminalService: IClaudeTerminalService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();

		// Git Graph
		this._register(statusbarService.addEntry({
			name: 'Git Graph',
			text: '$(git-branch) Graph',
			ariaLabel: 'Toggle Git Graph',
			command: { id: 'xlaunchpad.toggleGitGraph', title: '' },
			tooltip: 'Toggle Git Graph (Ctrl+G)',
		}, 'xlaunchpad.gitGraph', StatusbarAlignment.LEFT, 100));

		// Kanban Board
		this._register(statusbarService.addEntry({
			name: 'Kanban Board',
			text: '$(checklist) Plan',
			ariaLabel: 'Toggle Kanban Board',
			command: { id: 'xlaunchpad.toggleKanban', title: '' },
			tooltip: 'Toggle Kanban Board (Ctrl+Shift+K)',
		}, 'xlaunchpad.kanban', StatusbarAlignment.LEFT, 99));

		// Claude Terminal
		this._claudeEntry = this._register(statusbarService.addEntry({
			name: 'Claude Terminal',
			text: '$(hubot) Claude',
			ariaLabel: 'Toggle Claude Terminal',
			command: { id: 'xlaunchpad.toggleClaudeTerminal', title: '' },
			tooltip: 'Toggle Claude Terminal (Ctrl+Shift+C)',
		}, 'xlaunchpad.claudeTerminal', StatusbarAlignment.LEFT, 98));

		// Update badge when session count changes
		this._register(this._claudeTerminalService.onDidChangeSessionCount(() => this._updateBadge()));

		// Setup right-click context menu on Claude button
		this._setupContextMenu();
	}

	private _updateBadge(): void {
		const count = this._claudeTerminalService.minimizedCount;
		const text = count > 0 ? `$(hubot) Claude [${count}]` : '$(hubot) Claude';
		this._claudeEntry.update({
			name: 'Claude Terminal',
			text,
			ariaLabel: 'Toggle Claude Terminal',
			command: { id: 'xlaunchpad.toggleClaudeTerminal', title: '' },
			tooltip: 'Toggle Claude Terminal (Ctrl+Shift+C)',
		});
	}

	private _setupContextMenu(): void {
		const tryAttach = (retries: number) => {
			const element = document.querySelector('[id="xlaunchpad.claudeTerminal"]');
			if (element) {
				this._register(addDisposableListener(element, 'contextmenu', e => {
					e.preventDefault();
					e.stopPropagation();
					this._commandService.executeCommand('xlaunchpad.showClaudeSessions');
				}));
			} else if (retries > 0) {
				setTimeout(() => tryAttach(retries - 1), 500);
			}
		};
		tryAttach(10);
	}
}
