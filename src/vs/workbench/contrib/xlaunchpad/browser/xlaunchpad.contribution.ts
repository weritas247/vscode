/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IXLaunchpadService } from '../common/xlaunchpad.js';
import { XLaunchpadService } from './xlaunchpadService.js';
import { XLaunchpadStatusBarContribution } from './statusbar/xlaunchpadStatusBar.js';

// --- Service Registration ---
registerSingleton(IXLaunchpadService, XLaunchpadService, InstantiationType.Delayed);

// --- Status Bar Contribution ---
registerWorkbenchContribution2(
	XLaunchpadStatusBarContribution.ID,
	XLaunchpadStatusBarContribution,
	WorkbenchPhase.AfterRestored,
);

// --- Commands ---

// Toggle Git Graph (Ctrl+G)
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'xlaunchpad.toggleGitGraph',
			title: localize2('toggleGitGraph', 'Toggle Git Graph'),
			category: Categories.View,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyG,
			},
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IXLaunchpadService).toggleGitGraphModal();
	}
});

// Toggle Kanban Board (Ctrl+Shift+K)
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'xlaunchpad.toggleKanban',
			title: localize2('toggleKanban', 'Toggle Kanban Board'),
			category: Categories.View,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyK,
			},
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IXLaunchpadService).toggleKanbanModal();
	}
});

// Toggle Claude Monitor (Ctrl+Shift+M)
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'xlaunchpad.toggleClaudeMonitor',
			title: localize2('toggleClaudeMonitor', 'Toggle Claude Monitor'),
			category: Categories.View,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyM,
			},
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IXLaunchpadService).toggleClaudeMonitorModal();
	}
});
