/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './claudeTerminalModal.css';
import { $, addDisposableListener, clearNode, EventType } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { TERMINAL_BACKGROUND_COLOR, TERMINAL_FOREGROUND_COLOR, TERMINAL_CURSOR_FOREGROUND_COLOR, TERMINAL_CURSOR_BACKGROUND_COLOR, TERMINAL_SELECTION_BACKGROUND_COLOR, ansiColorIdentifiers } from '../../../../contrib/terminal/common/terminalColorRegistry.js';
import { XLaunchpadModal, IXLaunchpadTab } from '../modal/xlaunchpadModal.js';
import type { Terminal as XtermTerminal, ITheme as IXtermTheme } from '@xterm/xterm';
import type { IColorTheme } from '../../../../../platform/theme/common/themeService.js';

/**
 * Simple fit helper that resizes a terminal to fill its container.
 * This avoids a dependency on @xterm/addon-fit which is not available.
 */
class FitHelper {
	private terminal: XtermTerminal | undefined;
	private element: HTMLElement | undefined;

	activate(terminal: XtermTerminal): void {
		this.terminal = terminal;
		this.element = terminal.element?.parentElement ?? undefined;
	}

	dispose(): void {
		this.terminal = undefined;
		this.element = undefined;
	}

	fit(): void {
		const terminal = this.terminal;
		const element = this.element;
		if (!terminal || !element) {
			return;
		}
		const core = (terminal as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } } })._core;
		const cellWidth = core?._renderService?.dimensions?.css?.cell?.width;
		const cellHeight = core?._renderService?.dimensions?.css?.cell?.height;
		if (!cellWidth || !cellHeight) {
			return;
		}
		const cols = Math.max(2, Math.floor(element.clientWidth / cellWidth));
		const rows = Math.max(1, Math.floor(element.clientHeight / cellHeight));
		if (terminal.cols !== cols || terminal.rows !== rows) {
			terminal.resize(cols, rows);
		}
	}
}

export class ClaudeTerminalModal extends XLaunchpadModal {

	private readonly _onDidRequestMinimize = this._register(new Emitter<void>());
	readonly onDidRequestMinimize = this._onDidRequestMinimize.event;

	private readonly _onDidRequestClose = this._register(new Emitter<void>());
	readonly onDidRequestClose = this._onDidRequestClose.event;

	private xtermInstance: XtermTerminal | undefined;
	private fitHelper: FitHelper | undefined;
	private ptyProcess: { write(data: string): void; kill(): void } | undefined;
	private terminalContainer: HTMLElement | undefined;

	constructor(
		id: string,
		label: string,
		@ILayoutService layoutService: ILayoutService,
		@IStorageService storageService: IStorageService,
		@IThemeService private readonly themeService: IThemeService,
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
		this.initTerminal(this.terminalContainer);
	}

	protected onTabChanged(_tabId: string): void {
		// no-op — single content, no tabs
	}

	protected override onMinimize(): void {
		this._onDidRequestMinimize.fire();
		this.hide();
	}

	protected override onDidResize(): void {
		if (this.fitHelper) {
			this.fitHelper.fit();
		}
	}

	private async initTerminal(container: HTMLElement): Promise<void> {
		try {
			const xtermModule = await import('@xterm/xterm');

			const theme = this.buildXtermTheme(this.themeService.getColorTheme());

			const terminal = new xtermModule.Terminal({
				theme,
				fontFamily: 'monospace',
				fontSize: 13,
				lineHeight: 1.2,
				cursorBlink: true,
				scrollback: 10000,
			});

			terminal.open(container);

			this.fitHelper = new FitHelper();
			this.fitHelper.activate(terminal);

			requestAnimationFrame(() => {
				this.fitHelper?.fit();
			});

			this.xtermInstance = terminal;

			// Listen for theme changes
			this._register(this.themeService.onDidColorThemeChange(colorTheme => {
				terminal.options.theme = this.buildXtermTheme(colorTheme);
			}));

			// Spawn pty process
			await this.spawnPty(terminal);
		} catch (err) {
			this.showError(container, err instanceof Error ? err.message : String(err));
		}
	}

	private async spawnPty(terminal: XtermTerminal): Promise<void> {
		try {
			const nodePty = await import('node-pty');
			const shell = process.env.SHELL || '/bin/zsh';
			const cwd = process.env.HOME || '/';

			const pty = nodePty.spawn(shell, [], {
				name: 'xterm-256color',
				cols: terminal.cols,
				rows: terminal.rows,
				cwd,
				env: process.env as Record<string, string>,
			});

			this.ptyProcess = {
				write: (data: string) => pty.write(data),
				kill: () => pty.kill(),
			};

			pty.onData(data => {
				terminal.write(data);
			});

			terminal.onData(data => {
				pty.write(data);
			});

			terminal.onResize(({ cols, rows }) => {
				pty.resize(cols, rows);
			});

			pty.onExit(() => {
				terminal.write('\r\n[Session ended]\r\n');
				this.ptyProcess = undefined;
			});

			// Auto-run claude after a short delay
			setTimeout(() => {
				pty.write('claude --dangerously-skip-permissions\r');
			}, 500);
		} catch (err) {
			if (this.terminalContainer) {
				this.showError(this.terminalContainer, err instanceof Error ? err.message : String(err));
			}
		}
	}

	private buildXtermTheme(colorTheme: IColorTheme): IXtermTheme {
		const foreground = colorTheme.getColor(TERMINAL_FOREGROUND_COLOR);
		const background = colorTheme.getColor(TERMINAL_BACKGROUND_COLOR);
		const cursor = colorTheme.getColor(TERMINAL_CURSOR_FOREGROUND_COLOR) || foreground;
		const cursorAccent = colorTheme.getColor(TERMINAL_CURSOR_BACKGROUND_COLOR) || background;
		const selectionBackground = colorTheme.getColor(TERMINAL_SELECTION_BACKGROUND_COLOR);

		return {
			foreground: foreground?.toString(),
			background: background?.toString(),
			cursor: cursor?.toString(),
			cursorAccent: cursorAccent?.toString(),
			selectionBackground: selectionBackground?.toString(),
			black: colorTheme.getColor(ansiColorIdentifiers[0])?.toString(),
			red: colorTheme.getColor(ansiColorIdentifiers[1])?.toString(),
			green: colorTheme.getColor(ansiColorIdentifiers[2])?.toString(),
			yellow: colorTheme.getColor(ansiColorIdentifiers[3])?.toString(),
			blue: colorTheme.getColor(ansiColorIdentifiers[4])?.toString(),
			magenta: colorTheme.getColor(ansiColorIdentifiers[5])?.toString(),
			cyan: colorTheme.getColor(ansiColorIdentifiers[6])?.toString(),
			white: colorTheme.getColor(ansiColorIdentifiers[7])?.toString(),
			brightBlack: colorTheme.getColor(ansiColorIdentifiers[8])?.toString(),
			brightRed: colorTheme.getColor(ansiColorIdentifiers[9])?.toString(),
			brightGreen: colorTheme.getColor(ansiColorIdentifiers[10])?.toString(),
			brightYellow: colorTheme.getColor(ansiColorIdentifiers[11])?.toString(),
			brightBlue: colorTheme.getColor(ansiColorIdentifiers[12])?.toString(),
			brightMagenta: colorTheme.getColor(ansiColorIdentifiers[13])?.toString(),
			brightCyan: colorTheme.getColor(ansiColorIdentifiers[14])?.toString(),
			brightWhite: colorTheme.getColor(ansiColorIdentifiers[15])?.toString(),
		};
	}

	private showError(container: HTMLElement, message: string): void {
		clearNode(container);
		const errorDiv = container.appendChild($('.claude-terminal-error'));
		const icon = errorDiv.appendChild($('.claude-terminal-error-icon'));
		icon.textContent = '\u26A0'; // ⚠
		const text = errorDiv.appendChild($('.claude-terminal-error-text'));
		text.textContent = message;
		const retryBtn = errorDiv.appendChild($('button.claude-terminal-error-retry'));
		retryBtn.textContent = 'Retry';
		this._register(addDisposableListener(retryBtn, EventType.CLICK, () => {
			clearNode(container);
			this.initTerminal(container);
		}));
	}

	killProcess(): void {
		if (this.ptyProcess) {
			this.ptyProcess.kill();
			this.ptyProcess = undefined;
		}
	}

	override dispose(): void {
		this.killProcess();
		if (this.xtermInstance) {
			this.xtermInstance.dispose();
			this.xtermInstance = undefined;
		}
		this.fitHelper = undefined;
		super.dispose();
	}
}
