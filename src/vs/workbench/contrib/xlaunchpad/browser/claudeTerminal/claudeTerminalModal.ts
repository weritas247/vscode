/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './claudeTerminalModal.css';
import { $ } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { XLaunchpadModal, IXLaunchpadTab } from '../modal/xlaunchpadModal.js';
import { ITerminalService, ITerminalInstance } from '../../../../contrib/terminal/browser/terminal.js';
import { TerminalLocation } from '../../../../../platform/terminal/common/terminal.js';

export class ClaudeTerminalModal extends XLaunchpadModal {

	private readonly _onDidRequestMinimize = this._register(new Emitter<void>());
	readonly onDidRequestMinimize = this._onDidRequestMinimize.event;

	private terminalInstance: ITerminalInstance | undefined;
	private terminalContainer: HTMLElement | undefined;

	constructor(
		id: string,
		label: string,
		@ILayoutService layoutService: ILayoutService,
		@IStorageService storageService: IStorageService,
		@ITerminalService private readonly terminalService: ITerminalService,
	) {
		super(
			id,
			label,
			900, 600,
			500, 350,
			true,
			layoutService,
			storageService,
		);
	}

	protected getTabs(): IXLaunchpadTab[] {
		return [];
	}

	protected renderTabContent(_tabId: string, container: HTMLElement): void {
		this.terminalContainer = container.appendChild($('.claude-terminal-container'));
		this.initTerminal();
	}

	protected onTabChanged(_tabId: string): void {
		// no-op — single content, no tabs
	}

	protected override onMinimize(): void {
		this._onDidRequestMinimize.fire();
		this.hide();
	}

	protected override onDidResize(): void {
		if (this.terminalInstance && this.terminalContainer) {
			this.terminalInstance.layout({
				width: this.terminalContainer.clientWidth,
				height: this.terminalContainer.clientHeight,
			});
		}
	}

	private async initTerminal(): Promise<void> {
		if (!this.terminalContainer) {
			return;
		}

		try {
			// Create a hidden terminal instance via VS Code terminal service
			this.terminalInstance = await this.terminalService.createTerminal({
				config: {
					name: 'Claude',
					initialText: { text: 'claude --dangerously-skip-permissions', trailingNewLine: true },
					hideFromUser: true,
					isFeatureTerminal: true,
				},
				location: TerminalLocation.Panel,
			});

			// Attach the terminal's xterm element into our modal container
			this.terminalInstance.attachToElement(this.terminalContainer);

			// Mark visible to trigger xterm open/render
			this.terminalInstance.setVisible(true);

			// Layout after the DOM has been updated
			requestAnimationFrame(() => {
				if (this.terminalInstance && this.terminalContainer) {
					this.terminalInstance.layout({
						width: this.terminalContainer.clientWidth,
						height: this.terminalContainer.clientHeight,
					});
				}
			});
		} catch (err) {
			this.terminalContainer.textContent = `Failed to create terminal: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	killProcess(): void {
		if (this.terminalInstance) {
			this.terminalInstance.dispose();
			this.terminalInstance = undefined;
		}
	}

	override dispose(): void {
		this.killProcess();
		super.dispose();
	}
}
