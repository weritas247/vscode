/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IAction, Separator } from '../../../../base/common/actions.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInputWithOptions } from '../../../common/editor.js';
import { IXLaunchpadService, IClaudeTerminalService, claudeTerminalFocusContextKey } from '../common/xlaunchpad.js';
import { XLaunchpadService } from './xlaunchpadService.js';
import { ClaudeTerminalService } from './claudeTerminal/claudeTerminalService.js';
import { XLaunchpadStatusBarContribution } from './statusbar/xlaunchpadStatusBar.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ResourceContextKey } from '../../../common/contextkeys.js';
import { ExplorerFolderContext } from '../../files/common/files.js';
import { IExplorerService } from '../../files/browser/files.js';
import { FilePreviewEditor } from './filePreview/filePreviewEditor.js';
import { FilePreviewEditorInput } from './filePreview/filePreviewEditorInput.js';

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
			label: '+ New Quick Claude',
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

// --- File Preview: EditorPane Registration ---

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		FilePreviewEditor,
		FilePreviewEditor.ID,
		localize('filePreviewEditor', "File Preview")
	),
	[
		new SyncDescriptor(FilePreviewEditorInput)
	]
);

// Serializer (non-persistent — preview tabs don't survive restart)
class FilePreviewEditorInputSerializer implements IEditorSerializer {
	canSerialize(): boolean { return false; }
	serialize(): string | undefined { return undefined; }
	deserialize(): FilePreviewEditorInput | undefined { return undefined; }
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory)
	.registerEditorSerializer(FilePreviewEditorInput.ID, FilePreviewEditorInputSerializer);

// --- IEditorResolverService: auto-open md/html in our preview tab ---

const FILE_PREVIEW_PATTERN = '*.{md,markdown,mdown,mkd,html,htm}';

class FilePreviewResolverContribution extends Disposable {
	static readonly ID = 'xlaunchpad.filePreviewResolver';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._register(editorResolverService.registerEditor(
			FILE_PREVIEW_PATTERN,
			{
				id: FilePreviewEditorInput.ID,
				label: localize('filePreview', "File Preview"),
				detail: localize('filePreviewDetail', "X-Launchpad Preview"),
				priority: RegisteredEditorPriority.default,
			},
			{
				singlePerResource: true,
			},
			{
				createEditorInput: ({ resource }): EditorInputWithOptions => {
					return {
						editor: instantiationService.createInstance(FilePreviewEditorInput, resource),
					};
				},
			}
		));
	}
}

registerWorkbenchContribution2(
	FilePreviewResolverContribution.ID,
	FilePreviewResolverContribution,
	WorkbenchPhase.AfterRestored,
);

// --- Explorer context menu: Preview File ---

const previewFileCondition = ContextKeyExpr.and(
	ExplorerFolderContext.toNegated(),
	ResourceContextKey.HasResource,
	ContextKeyExpr.or(
		ResourceContextKey.Extension.isEqualTo('.md'),
		ResourceContextKey.Extension.isEqualTo('.markdown'),
		ResourceContextKey.Extension.isEqualTo('.html'),
		ResourceContextKey.Extension.isEqualTo('.htm'),
	),
);

MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
	group: '3_preview',
	order: 1,
	command: {
		id: 'xlaunchpad.previewFileFromExplorer',
		title: localize2('previewFile', 'Preview File'),
	},
	when: previewFileCondition,
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'xlaunchpad.previewFileFromExplorer',
			title: localize2('previewFile', 'Preview File'),
			category: Categories.View,
			f1: false,
		});
	}
	run(accessor: ServicesAccessor): void {
		const explorerService = accessor.get(IExplorerService);
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		const items = explorerService.getContext(false);
		if (items.length > 0 && items[0].resource) {
			const input = instantiationService.createInstance(FilePreviewEditorInput, items[0].resource);
			editorService.openEditor(input);
		}
	}
});

// Open File Preview command (command palette — opens current active editor file in preview)
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'xlaunchpad.openFilePreview',
			title: localize2('openFilePreview', 'Open File Preview'),
			category: Categories.View,
			f1: true,
		});
	}
	run(accessor: ServicesAccessor): void {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		const resource = editorService.activeEditor?.resource;
		if (resource) {
			const input = instantiationService.createInstance(FilePreviewEditorInput, resource);
			editorService.openEditor(input);
		}
	}
});
