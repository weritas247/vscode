/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const claudeTerminalFocusContextKey = new RawContextKey<boolean>('claudeTerminalFocus', false);

export const IXLaunchpadService = createDecorator<IXLaunchpadService>('xlaunchpadService');

export interface IXLaunchpadService {
	readonly _serviceBrand: undefined;

	toggleGitGraphModal(): void;
	toggleKanbanModal(): void;
	toggleClaudeMonitorModal(): void;

	isModalOpen(modalId: string): boolean;
}

export interface IClaudeTerminalSession {
	readonly id: string;
	readonly label: string;
	readonly minimized: boolean;
}

export const IClaudeTerminalService = createDecorator<IClaudeTerminalService>('claudeTerminalService');

export interface IClaudeTerminalService {
	readonly _serviceBrand: undefined;

	createSession(): void;
	closeSession(id: string): void;
	closeActiveSession(): void;
	minimizeActiveSession(): void;
	toggleLastSession(): void;
	minimizeSession(id: string): void;
	restoreSession(id: string): void;

	getSessions(): IClaudeTerminalSession[];
	readonly minimizedCount: number;
	readonly onDidChangeSessionCount: Event<number>;
}

export const XLaunchpadModalId = {
	GitGraph: 'xlaunchpad.gitGraph',
	Kanban: 'xlaunchpad.kanban',
	ClaudeMonitor: 'xlaunchpad.claudeMonitor',
	ClaudeTerminal: 'xlaunchpad.claudeTerminal',
} as const;
