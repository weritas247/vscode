/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ISCMService, ISCMRepository } from '../../../scm/common/scm.js';
import { ISCMHistoryProvider, ISCMHistoryItem } from '../../../scm/common/history.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';

export interface ICommitEntry {
	hash: string;
	parents: string[];
	refs: string[];
	author: string;
	authorEmail: string;
	date: string;
	message: string;
	body: string;
	additions: number;
	deletions: number;
}

export interface IChangedFile {
	path: string;
	status: 'M' | 'A' | 'D' | 'R';
	additions: number;
	deletions: number;
}

export interface IGitStatusFile {
	status: string; // 'M', 'A', 'D', '?', etc.
	path: string;
	staged: boolean;
}

export interface IGraphPosition {
	x: number;
	y: number;
	col: number;
	color: string;
}

const BRANCH_COLORS = [
	'#3794ff', // VS Code blue
	'#e06c75',
	'#98c379',
	'#e5c07b',
	'#61afef',
	'#c678dd',
	'#56b6c2',
];

const ROW_H = 36;
const COL_W = 16;
const PAD_X = 12;

export class GitGraphDataService {

	constructor(
		@ISCMService private readonly scmService: ISCMService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ICommandService readonly commandService: ICommandService,
		@IFileService private readonly fileService: IFileService,
	) { }

	private getRepository(): { repo: ISCMRepository; historyProvider: ISCMHistoryProvider } | undefined {
		for (const repo of this.scmService.repositories) {
			const provider = repo.provider;
			if (provider.providerId !== 'git') {
				continue;
			}
			const historyProvider = provider.historyProvider.get();
			if (historyProvider) {
				return { repo, historyProvider };
			}
		}

		return undefined;
	}

	/**
	 * Wait for a git SCM repository with a ready history provider.
	 * The git extension may still be initializing when the modal opens,
	 * and the historyProvider observable may not yet have a value.
	 */
	async waitForRepository(timeoutMs = 8000): Promise<{ repo: ISCMRepository; historyProvider: ISCMHistoryProvider } | undefined> {
		const pollIntervalMs = 300;
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const result = this.getRepository();
			if (result) {
				return result;
			}
			await new Promise<void>(resolve => setTimeout(resolve, pollIntervalMs));
		}

		return undefined;
	}

	async getCommits(maxCount = 20, skip = 0): Promise<{ commits: ICommitEntry[]; hasMore: boolean }> {
		const entry = this.getRepository() ?? await this.waitForRepository();
		if (!entry) {
			return { commits: [], hasMore: false };
		}

		const { historyProvider } = entry;
		const cts = new CancellationTokenSource();

		try {
			// Gather all available refs (branches, tags) so git log covers all history
			const allRefs = await historyProvider.provideHistoryItemRefs(undefined, cts.token);
			const refIds = allRefs?.map(r => r.id) ?? [];

			// Fallback: if no refs available, try HEAD
			if (refIds.length === 0) {
				const currentRef = historyProvider.historyItemRef.get();
				if (currentRef) {
					refIds.push(currentRef.id);
				}
			}

			if (refIds.length === 0) {
				return { commits: [], hasMore: false };
			}

			const items = await historyProvider.provideHistoryItems(
				{ limit: maxCount + 1, skip, historyItemRefs: refIds },
				cts.token,
			);

			if (!items) {
				return { commits: [], hasMore: false };
			}

			const hasMore = items.length > maxCount;
			const slice = hasMore ? items.slice(0, maxCount) : items;

			const commits: ICommitEntry[] = slice.map(item => this.toCommitEntry(item));
			return { commits, hasMore };
		} catch {
			return { commits: [], hasMore: false };
		} finally {
			cts.dispose();
		}
	}

	private toCommitEntry(item: ISCMHistoryItem): ICommitEntry {
		const refs: string[] = [];
		if (item.references) {
			for (const ref of item.references) {
				refs.push(ref.name);
			}
		}

		return {
			hash: item.id,
			parents: item.parentIds ?? [],
			refs,
			author: item.author ?? '',
			authorEmail: item.authorEmail ?? '',
			date: item.timestamp ? new Date(item.timestamp).toISOString() : '',
			message: item.subject ?? '',
			body: item.message ?? '',
			additions: item.statistics?.insertions ?? 0,
			deletions: item.statistics?.deletions ?? 0,
		};
	}

	async getChangedFiles(commit: ICommitEntry): Promise<IChangedFile[]> {
		const entry = this.getRepository();
		if (!entry) {
			return [];
		}

		const { historyProvider } = entry;
		const parentId = commit.parents.length > 0 ? commit.parents[0] : undefined;
		const cts = new CancellationTokenSource();

		try {
			const changes = await historyProvider.provideHistoryItemChanges(commit.hash, parentId, cts.token);
			if (!changes) {
				return [];
			}

			const rootPath = entry.repo.provider.rootUri?.fsPath ?? '';
			return changes.map(change => {
				let fullPath = change.uri.fsPath;
				if (rootPath && fullPath.startsWith(rootPath)) {
					fullPath = fullPath.substring(rootPath.length + 1);
				}
				// Determine status from URIs
				let status: 'M' | 'A' | 'D' | 'R' = 'M';
				if (!change.originalUri) {
					status = 'A';
				} else if (!change.modifiedUri) {
					status = 'D';
				}
				return { path: fullPath, status, additions: 0, deletions: 0 };
			});
		} catch {
			return [];
		} finally {
			cts.dispose();
		}
	}

	async getStatus(): Promise<IGitStatusFile[]> {
		const entry = this.getRepository() ?? await this.waitForRepository();
		if (!entry) {
			return [];
		}

		const files: IGitStatusFile[] = [];
		const rootUri = entry.repo.provider.rootUri;

		for (const group of entry.repo.provider.groups) {
			const staged = group.id === 'index';
			for (const resource of group.resources) {
				let status: string;
				switch (group.id) {
					case 'index': status = 'S'; break;        // Staged
					case 'merge': status = 'C'; break;        // Conflict
					case 'untracked': status = '?'; break;    // Untracked
					default: status = 'M'; break;             // Modified (workingTree)
				}

				// Show relative path if workspace root is available
				let displayPath = resource.sourceUri.fsPath;
				if (rootUri) {
					const rootPath = rootUri.fsPath;
					if (displayPath.startsWith(rootPath)) {
						displayPath = displayPath.substring(rootPath.length + 1);
					}
				}

				files.push({ status, path: displayPath, staged });
			}
		}

		return files;
	}

	/**
	 * Get a unified diff string for a changed file by reading its
	 * original and modified content through the SCM text model URIs.
	 */
	async getDiff(filePath: string): Promise<string> {
		const entry = this.getRepository() ?? await this.waitForRepository();
		if (!entry) {
			return '';
		}

		for (const group of entry.repo.provider.groups) {
			for (const resource of group.resources) {
				if (!resource.sourceUri.fsPath.endsWith(filePath) && resource.sourceUri.fsPath !== filePath) {
					continue;
				}

				const origUri = resource.multiDiffEditorOriginalUri;
				const modUri = resource.multiDiffEditorModifiedUri;

				let origLines: string[] = [];
				let modLines: string[] = [];

				if (origUri) {
					try {
						const ref = await this.textModelService.createModelReference(origUri);
						origLines = ref.object.textEditorModel?.getLinesContent() ?? [];
						ref.dispose();
					} catch { /* new file, no original */ }
				}

				if (modUri) {
					try {
						const ref = await this.textModelService.createModelReference(modUri);
						modLines = ref.object.textEditorModel?.getLinesContent() ?? [];
						ref.dispose();
					} catch { /* deleted file, no modified */ }
				}

				return this.buildUnifiedDiff(origLines, modLines, filePath);
			}
		}
		return '';
	}

	private buildUnifiedDiff(origLines: string[], modLines: string[], filePath: string): string {
		const result: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

		// Simple line-by-line diff (not optimal but readable)
		const maxLen = Math.max(origLines.length, modLines.length);
		let hunkStart = -1;
		const hunkLines: string[] = [];

		const flushHunk = () => {
			if (hunkLines.length > 0) {
				result.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@`);
				result.push(...hunkLines);
				hunkLines.length = 0;
			}
			hunkStart = -1;
		};

		for (let i = 0; i < maxLen; i++) {
			const o = i < origLines.length ? origLines[i] : undefined;
			const m = i < modLines.length ? modLines[i] : undefined;

			if (o === m) {
				if (hunkLines.length > 0) {
					hunkLines.push(' ' + (o ?? ''));
					if (hunkLines.filter(l => l.startsWith(' ')).length > 3) {
						flushHunk();
					}
				}
				continue;
			}

			if (hunkStart === -1) {
				hunkStart = Math.max(0, i - 1);
				// Context line before
				if (i > 0 && i - 1 < origLines.length) {
					hunkLines.push(' ' + origLines[i - 1]);
				}
			}

			if (o !== undefined && m !== undefined) {
				hunkLines.push('-' + o);
				hunkLines.push('+' + m);
			} else if (o !== undefined) {
				hunkLines.push('-' + o);
			} else if (m !== undefined) {
				hunkLines.push('+' + m);
			}
		}

		flushHunk();
		return result.join('\n');
	}

	async getCurrentBranch(): Promise<string> {
		const entry = this.getRepository() ?? await this.waitForRepository();
		if (!entry) {
			return '';
		}

		const ref = entry.historyProvider.historyItemRef.get();
		return ref?.name ?? '';
	}

	getRepoName(): string {
		const entry = this.getRepository();
		if (!entry?.repo.provider.rootUri) {
			return '';
		}
		const fsPath = entry.repo.provider.rootUri.fsPath;
		return fsPath.substring(fsPath.lastIndexOf('/') + 1);
	}

	/**
	 * Read the remote 'origin' URL from `.git/config`.
	 * Returns a browser-friendly HTTPS URL if the remote is GitHub/GitLab-like.
	 */
	async getRemoteUrl(): Promise<string | undefined> {
		const entry = this.getRepository();
		const rootUri = entry?.repo.provider.rootUri;
		if (!rootUri) {
			return undefined;
		}

		try {
			const configUri = URI.joinPath(rootUri, '.git', 'config');
			const content = await this.fileService.readFile(configUri);
			const text = content.value.toString();

			// Parse git config to find [remote "origin"] url = ...
			const remoteRegex = /\[remote\s+"origin"\]\s*\n(?:\s+\w+\s*=\s*.*\n)*?\s*url\s*=\s*(.+)/m;
			const match = remoteRegex.exec(text);
			if (!match) {
				return undefined;
			}

			let url = match[1].trim();

			// Convert SSH URLs (git@github.com:user/repo.git) to HTTPS
			const sshMatch = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(url);
			if (sshMatch) {
				url = `https://${sshMatch[1]}/${sshMatch[2]}`;
			}

			// Strip trailing .git
			url = url.replace(/\.git$/, '');

			return url;
		} catch {
			return undefined;
		}
	}

	/**
	 * Execute a git pull using the built-in git extension command.
	 */
	async gitPull(): Promise<void> {
		const entry = this.getRepository();
		const rootUri = entry?.repo.provider.rootUri;
		await this.commandService.executeCommand('git.pull', rootUri);
	}

	/**
	 * Execute a git push using the built-in git extension command.
	 */
	async gitPush(): Promise<void> {
		const entry = this.getRepository();
		const rootUri = entry?.repo.provider.rootUri;
		await this.commandService.executeCommand('git.push', rootUri);
	}

	// ─── Graph Layout Computation ───────────────────────

	computeLayout(commits: ICommitEntry[]): { positions: Map<string, IGraphPosition>; svgWidth: number } {
		const lanes: (string | null)[] = [];
		const positions = new Map<string, IGraphPosition>();

		for (let i = 0; i < commits.length; i++) {
			const c = commits[i];
			let col = lanes.indexOf(c.hash);
			if (col === -1) {
				col = lanes.indexOf(null);
				if (col === -1) {
					col = lanes.length;
					lanes.push(null);
				}
			}
			lanes[col] = null;

			const x = PAD_X + col * COL_W;
			const y = ROW_H / 2 + i * ROW_H;
			const color = BRANCH_COLORS[col % BRANCH_COLORS.length];
			positions.set(c.hash, { x, y, col, color });

			for (let pi = 0; pi < c.parents.length; pi++) {
				const ph = c.parents[pi];
				if (positions.has(ph)) {
					continue;
				}
				if (pi === 0) {
					lanes[col] = ph;
				} else {
					let pcol = lanes.indexOf(ph);
					if (pcol === -1) {
						pcol = lanes.indexOf(null);
						if (pcol === -1) {
							pcol = lanes.length;
							lanes.push(null);
						}
						lanes[pcol] = ph;
					}
				}
			}

			while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
				lanes.pop();
			}
		}

		const maxCol = Math.max(...Array.from(positions.values()).map(p => p.col), 0);
		const svgWidth = PAD_X * 2 + maxCol * COL_W + 8;

		return { positions, svgWidth };
	}

	buildSvg(commits: ICommitEntry[], positions: Map<string, IGraphPosition>, svgWidth: number, totalHeight: number): string {
		let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${totalHeight}" style="position:absolute;left:0;top:0">`;

		// Edges
		for (const c of commits) {
			const pos = positions.get(c.hash);
			if (!pos) {
				continue;
			}
			for (const ph of c.parents) {
				const ppos = positions.get(ph);
				if (!ppos) {
					continue;
				}
				if (pos.x === ppos.x) {
					svg += `<line x1="${pos.x}" y1="${pos.y}" x2="${ppos.x}" y2="${ppos.y}" stroke="${ppos.color}" stroke-width="1.5" />`;
				} else {
					const R = 8;
					const dx = ppos.x - pos.x;
					const dir = dx > 0 ? 1 : -1;
					const bendY = ppos.y - R;
					svg += `<path d="M${pos.x},${pos.y} L${pos.x},${bendY} Q${pos.x},${ppos.y} ${pos.x + R * dir},${ppos.y} L${ppos.x},${ppos.y}" stroke="${ppos.color}" stroke-width="1.5" fill="none" />`;
				}
			}
		}

		// Nodes
		for (const c of commits) {
			const p = positions.get(c.hash);
			if (!p) {
				continue;
			}
			svg += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${p.color}" />`;
		}

		svg += '</svg>';
		return svg;
	}

	static readonly ROW_H = ROW_H;
}
