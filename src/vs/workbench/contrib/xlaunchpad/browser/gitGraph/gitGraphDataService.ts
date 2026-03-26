/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ISCMService, ISCMRepository } from '../../../scm/common/scm.js';
import { ISCMHistoryProvider, ISCMHistoryItem } from '../../../scm/common/history.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';

export interface ICommitEntry {
	hash: string;
	parents: string[];
	refs: string[];
	author: string;
	date: string;
	message: string;
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
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
	) { }

	private getRepository(): { repo: ISCMRepository; historyProvider: ISCMHistoryProvider } | undefined {
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length === 0) {
			return undefined;
		}

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

	async getCommits(maxCount = 50, _skip = 0): Promise<{ commits: ICommitEntry[]; hasMore: boolean }> {
		const entry = this.getRepository();
		if (!entry) {
			return { commits: [], hasMore: false };
		}

		const { historyProvider } = entry;
		const cts = new CancellationTokenSource();

		try {
			const items = await historyProvider.provideHistoryItems(
				{ limit: maxCount + 1 },
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
			date: item.timestamp ? new Date(item.timestamp).toISOString() : '',
			message: item.subject ?? item.message ?? '',
			additions: item.statistics?.insertions ?? 0,
			deletions: item.statistics?.deletions ?? 0,
		};
	}

	async getStatus(): Promise<IGitStatusFile[]> {
		const entry = this.getRepository();
		if (!entry) {
			return [];
		}

		// Use SCM resource groups to get status
		const files: IGitStatusFile[] = [];
		for (const group of entry.repo.provider.groups) {
			const staged = group.id === 'index';
			for (const resource of group.resources) {
				const status = staged ? 'M' : (group.id === 'untracked' ? '?' : 'M');
				files.push({
					status,
					path: resource.sourceUri.fsPath,
					staged,
				});
			}
		}

		return files;
	}

	async getDiff(filePath: string, staged: boolean): Promise<string> {
		const entry = this.getRepository();
		if (!entry) {
			return '';
		}

		// Diffs are not directly available via SCM service in a simple text form.
		// For now, return empty. The diff viewer in VS Code handles this through editors.
		void filePath;
		void staged;
		return '';
	}

	async getCurrentBranch(): Promise<string> {
		const entry = this.getRepository();
		if (!entry) {
			return '';
		}

		const ref = entry.historyProvider.historyItemRef.get();
		return ref?.name ?? '';
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
