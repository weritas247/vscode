/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarService, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';

export class XLaunchpadStatusBarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.xlaunchpadStatusBar';

	constructor(
		@IStatusbarService statusbarService: IStatusbarService,
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

		// Claude Monitor
		this._register(statusbarService.addEntry({
			name: 'Claude Monitor',
			text: '$(hubot) Claude',
			ariaLabel: 'Toggle Claude Monitor',
			command: { id: 'xlaunchpad.toggleClaudeMonitor', title: '' },
			tooltip: 'Toggle Claude Monitor (Ctrl+Shift+M)',
		}, 'xlaunchpad.claudeMonitor', StatusbarAlignment.LEFT, 98));
	}
}
