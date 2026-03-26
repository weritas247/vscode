/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './filePreviewModal.css';
import { $, addDisposableListener, clearNode, EventType, getWindow } from '../../../../../base/browser/dom.js';
import { renderMarkdown } from '../../../../../base/browser/markdownRenderer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IWebviewElement, IWebviewService } from '../../../webview/browser/webview.js';
import { FilePreviewEditorInput } from './filePreviewEditorInput.js';

type PreviewTheme = 'dark' | 'light' | 'raw';

const THEME_CYCLE: readonly PreviewTheme[] = ['dark', 'light', 'raw'];
const THEME_ICONS: Record<PreviewTheme, string> = { dark: '\uD83C\uDF19', light: '\u2600\uFE0F', raw: '\uD83D\uDCC4' };
const THEME_TITLES: Record<PreviewTheme, string> = {
	dark: 'Dark mode (click for Light)',
	light: 'Light mode (click for Raw)',
	raw: 'Raw mode (click for Dark)',
};

function isMarkdownFile(path: string): boolean {
	return /\.(md|markdown|mdown|mkd)$/i.test(path);
}

function isHtmlFile(path: string): boolean {
	return /\.(html?|htm)$/i.test(path);
}

function getThemeCss(theme: PreviewTheme): string {
	if (theme === 'dark') {
		return `
			html { filter: invert(0.92) hue-rotate(180deg); background: #fff; }
			img, video, canvas, svg, [style*="background-image"] { filter: invert(1) hue-rotate(180deg); }
		`;
	} else if (theme === 'light') {
		return `html, body { background: #faf6f0; }`;
	}
	return ''; // raw: no injection
}

export class FilePreviewEditor extends EditorPane {
	static readonly ID = 'workbench.editor.filePreview';

	private container: HTMLElement | undefined;
	private headerEl: HTMLElement | undefined;
	private contentEl: HTMLElement | undefined;
	private previewTheme: PreviewTheme = 'dark';
	private isSourceMode = false;
	private fileContent = '';
	private currentResource: URI | undefined;
	private webview: IWebviewElement | undefined;
	private readonly renderDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IWebviewService private readonly webviewService: IWebviewService,
	) {
		super(FilePreviewEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = parent.appendChild($('.xlaunchpad-file-preview-editor'));
		this.container.style.display = 'flex';
		this.container.style.flexDirection = 'column';
		this.container.style.height = '100%';
		this.container.style.overflow = 'hidden';

		this.headerEl = this.container.appendChild($('.xlaunchpad-file-preview-header'));
		this.contentEl = this.container.appendChild($('.xlaunchpad-file-preview-content'));
	}

	override async setInput(input: FilePreviewEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		this.currentResource = input.resource;
		this.isSourceMode = false;

		try {
			const content = await this.fileService.readFile(input.resource);
			this.fileContent = new TextDecoder().decode(content.value.buffer);
		} catch {
			this.fileContent = '';
		}

		if (token.isCancellationRequested) {
			return;
		}

		this.renderHeader();
		this.renderPreviewContent();
	}

	override clearInput(): void {
		this.renderDisposables.clear();
		this.disposeWebview();
		this.currentResource = undefined;
		this.fileContent = '';
		if (this.headerEl) {
			clearNode(this.headerEl);
		}
		if (this.contentEl) {
			clearNode(this.contentEl);
		}
		super.clearInput();
	}

	override layout(): void {
		// Content auto-fills via CSS flex
	}

	override focus(): void {
		super.focus();
		this.container?.focus();
	}

	// --- Rendering ---

	private renderHeader(): void {
		if (!this.headerEl || !this.currentResource) {
			return;
		}
		clearNode(this.headerEl);

		const filePath = this.currentResource.fsPath || this.currentResource.path;
		const fileName = basename(this.currentResource);
		const isMd = isMarkdownFile(fileName);
		const isHtml = isHtmlFile(fileName);
		const isPreviewable = isMd || isHtml;

		// Path display
		const pathEl = this.headerEl.appendChild($('.xlaunchpad-file-preview-path'));
		const pathParts = filePath.split('/');
		pathEl.textContent = pathParts.length > 3 ? '\u2026/' + pathParts.slice(-3).join('/') : filePath;
		pathEl.title = filePath;
		this.renderDisposables.add(addDisposableListener(pathEl, EventType.CLICK, () => {
			navigator.clipboard.writeText(filePath);
			const orig = pathEl.textContent;
			pathEl.textContent = 'Copied!';
			setTimeout(() => { pathEl.textContent = orig; }, 1000);
		}));

		// Actions area
		const actionsEl = this.headerEl.appendChild($('.xlaunchpad-file-preview-actions'));

		// Status label
		const statusEl = actionsEl.appendChild($('.xlaunchpad-file-preview-status'));
		statusEl.textContent = this.isSourceMode ? 'SOURCE' : 'PREVIEW';

		if (isPreviewable) {
			// Theme toggle button
			const themeBtn = actionsEl.appendChild($('.xlaunchpad-file-preview-btn.xlaunchpad-file-preview-theme-btn'));
			themeBtn.textContent = THEME_ICONS[this.previewTheme];
			themeBtn.title = THEME_TITLES[this.previewTheme];
			this.renderDisposables.add(addDisposableListener(themeBtn, EventType.CLICK, () => {
				this.cycleTheme();
			}));

			// Source/Preview toggle button
			const toggleBtn = actionsEl.appendChild($('.xlaunchpad-file-preview-btn'));
			toggleBtn.textContent = this.isSourceMode ? 'Preview' : 'Source';
			this.renderDisposables.add(addDisposableListener(toggleBtn, EventType.CLICK, () => {
				this.isSourceMode = !this.isSourceMode;
				this.renderHeader();
				this.renderPreviewContent();
			}));
		}
	}

	private renderPreviewContent(): void {
		if (!this.contentEl || !this.currentResource) {
			return;
		}
		this.disposeWebview();
		clearNode(this.contentEl);

		const fileName = basename(this.currentResource);
		const isMd = isMarkdownFile(fileName);
		const isHtml = isHtmlFile(fileName);

		if (this.isSourceMode || (!isMd && !isHtml)) {
			const sourceEl = this.contentEl.appendChild($('.xlaunchpad-file-preview-source'));
			sourceEl.textContent = this.fileContent;
			return;
		}

		if (isMd) {
			this.renderMarkdownPreview();
		} else if (isHtml) {
			this.renderHtmlPreview();
		}
	}

	private renderMarkdownPreview(): void {
		if (!this.contentEl) {
			return;
		}

		const container = this.contentEl.appendChild($('.xlaunchpad-md-preview-container'));
		this.applyThemeClass(container);

		const mdString = new MarkdownString(this.fileContent, { isTrusted: true, supportHtml: true });
		const rendered = renderMarkdown(mdString, {
			markedOptions: { gfm: true, breaks: true },
		});

		rendered.element.classList.add('xlaunchpad-md-preview');
		container.appendChild(rendered.element);
		this.renderDisposables.add(rendered);

		// Handle link clicks
		this.renderDisposables.add(addDisposableListener(rendered.element, EventType.CLICK, (e) => {
			const link = (e.target as HTMLElement).closest('a');
			if (!link) {
				return;
			}
			const href = link.getAttribute('href') || '';
			if (href.startsWith('#')) {
				e.preventDefault();
				const id = decodeURIComponent(href.slice(1));
				const target = rendered.element.querySelector(`[id="${CSS.escape(id)}"]`);
				if (target) {
					target.scrollIntoView({ behavior: 'smooth', block: 'start' });
				}
			} else if (/^https?:\/\//.test(href)) {
				e.preventDefault();
				this.openerService.open(URI.parse(href));
			}
		}));
	}

	private renderHtmlPreview(): void {
		if (!this.contentEl) {
			return;
		}

		const webviewContainer = this.contentEl.appendChild($('.xlaunchpad-html-preview-container'));
		webviewContainer.style.flex = '1';
		webviewContainer.style.minHeight = '0';

		this.webview = this.webviewService.createWebviewElement({
			title: basename(this.currentResource!),
			options: {},
			contentOptions: {
				allowScripts: true,
				allowForms: true,
			},
			extension: undefined,
		});

		this.webview.mountTo(webviewContainer, getWindow(webviewContainer));
		this.updateWebviewHtml();
		this.renderDisposables.add(this.webview);
	}

	private updateWebviewHtml(): void {
		if (!this.webview) {
			return;
		}

		const themeCss = getThemeCss(this.previewTheme);
		const themeStyle = themeCss ? `<style>${themeCss}</style>` : '';

		// Inject theme style at the end of <head> or before content
		const html = this.fileContent.replace(
			/(<\/head>)/i,
			`${themeStyle}$1`
		);

		// If no </head> tag, prepend the style
		if (html === this.fileContent && themeStyle) {
			this.webview.setHtml(`${themeStyle}${this.fileContent}`);
		} else {
			this.webview.setHtml(html);
		}
	}

	private cycleTheme(): void {
		const idx = THEME_CYCLE.indexOf(this.previewTheme);
		this.previewTheme = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];

		if (this.contentEl) {
			// Markdown: update CSS class
			const mdContainer = this.contentEl.querySelector('.xlaunchpad-md-preview-container') as HTMLElement;
			if (mdContainer) {
				this.applyThemeClass(mdContainer);
			}

			// HTML: re-set webview html with new theme
			if (this.webview) {
				this.updateWebviewHtml();
			}
		}

		// Update theme button
		if (this.headerEl) {
			const themeBtn = this.headerEl.querySelector('.xlaunchpad-file-preview-theme-btn') as HTMLElement | null;
			if (themeBtn) {
				themeBtn.textContent = THEME_ICONS[this.previewTheme];
				themeBtn.title = THEME_TITLES[this.previewTheme];
			}
		}
	}

	private applyThemeClass(container: HTMLElement): void {
		container.classList.remove('xlaunchpad-preview-light', 'xlaunchpad-preview-raw');
		if (this.previewTheme === 'light') {
			container.classList.add('xlaunchpad-preview-light');
		} else if (this.previewTheme === 'raw') {
			container.classList.add('xlaunchpad-preview-raw');
		}
	}

	private disposeWebview(): void {
		if (this.webview) {
			this.webview.dispose();
			this.webview = undefined;
		}
	}
}
