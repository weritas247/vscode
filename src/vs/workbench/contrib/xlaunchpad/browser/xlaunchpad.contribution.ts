/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IAction, Separator } from '../../../../base/common/actions.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IXLaunchpadService, IClaudeTerminalService, claudeTerminalFocusContextKey } from '../common/xlaunchpad.js';
import { XLaunchpadService } from './xlaunchpadService.js';
import { ClaudeTerminalService } from './claudeTerminal/claudeTerminalService.js';
import { XLaunchpadStatusBarContribution } from './statusbar/xlaunchpadStatusBar.js';

// --- Service Registration ---
registerSingleton(IXLaunchpadService, XLaunchpadService, InstantiationType.Delayed);
registerSingleton(IClaudeTerminalService, ClaudeTerminalService, InstantiationType.Delayed);

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

// Toggle Claude Terminal (Ctrl+Shift+C)
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'xlaunchpad.toggleClaudeTerminal',
			title: localize2('toggleClaudeTerminal', 'Toggle Claude Terminal'),
			category: Categories.View,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
			},
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IClaudeTerminalService).toggleLastSession();
	}
});

// Show Claude Sessions (context menu)
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'xlaunchpad.showClaudeSessions',
			title: localize2('showClaudeSessions', 'Show Claude Sessions'),
			category: Categories.View,
			f1: false,
		});
	}
	run(accessor: ServicesAccessor): void {
		const claudeTerminalService = accessor.get(IClaudeTerminalService);
		const contextMenuService = accessor.get(IContextMenuService);

		const sessions = claudeTerminalService.getSessions();
		const actions: IAction[] = [];

		for (const session of sessions) {
			actions.push({
				id: `restore-${session.id}`,
				label: session.label + (session.minimized ? '' : ' \u25CF'),
				enabled: true,
				class: undefined,
				tooltip: '',
				run: () => claudeTerminalService.restoreSession(session.id),
			});
		}

		if (sessions.length > 0) {
			actions.push(new Separator());
		}

		actions.push({
			id: 'new-claude-session',
			label: '+ New Claude Session',
			enabled: true,
			class: undefined,
			tooltip: '',
			run: () => claudeTerminalService.createSession(),
		});

		const statusBarElement = document.querySelector('[id="xlaunchpad.claudeTerminal"]');
		if (statusBarElement) {
			const rect = statusBarElement.getBoundingClientRect();
			contextMenuService.showContextMenu({
				getAnchor: () => ({ x: rect.left, y: rect.top }),
				getActions: () => actions,
			});
		}
	}
});

// Close Claude Terminal (Cmd+W when focused)
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'xlaunchpad.closeClaudeTerminal',
			title: localize2('closeClaudeTerminal', 'Close Claude Terminal'),
			category: Categories.View,
			f1: false,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 100,
				primary: KeyMod.CtrlCmd | KeyCode.KeyW,
				when: ContextKeyExpr.has(claudeTerminalFocusContextKey.key),
			},
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IClaudeTerminalService).closeActiveSession();
	}
});

// Minimize Claude Terminal (Cmd+M when focused)
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'xlaunchpad.minimizeClaudeTerminal',
			title: localize2('minimizeClaudeTerminal', 'Minimize Claude Terminal'),
			category: Categories.View,
			f1: false,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 100,
				primary: KeyMod.CtrlCmd | KeyCode.KeyM,
				when: ContextKeyExpr.has(claudeTerminalFocusContextKey.key),
			},
		});
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IClaudeTerminalService).minimizeActiveSession();
	}
});
