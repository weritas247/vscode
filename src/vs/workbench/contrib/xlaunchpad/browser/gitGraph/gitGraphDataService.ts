/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { promisify } from 'util';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';

const execFileAsync = promisify(cp.execFile);

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
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
	) {}

	private getCwd(): string | undefined {
		const folders = this.workspaceService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri.fsPath : undefined;
	}

	async getCommits(maxCount = 50, skip = 0): Promise<{ commits: ICommitEntry[]; hasMore: boolean }> {
		const cwd = this.getCwd();
		if (!cwd) {
			return { commits: [], hasMore: false };
		}

		const fetchCount = maxCount + 1;
		try {
			const { stdout: raw } = await execFileAsync(
				'git',
				[
					'log',
					'--format=%H%x00%P%x00%D%x00%an%x00%aI%x00%s%x01',
					`--max-count=${fetchCount}`,
					`--skip=${skip}`,
					'--topo-order',
					'--all',
				],
				{ cwd, encoding: 'utf-8', timeout: 10000 }
			);

			const allCommits = raw
				.trim()
				.split('\x01')
				.filter(Boolean)
				.map((record) => {
					const [hash, parentStr, refStr, author, date, message] = record.trim().split('\x00');
					return {
						hash,
						parents: parentStr ? parentStr.split(' ').filter(Boolean) : [],
						refs: refStr ? refStr.split(', ').map(r => r.trim()).filter(Boolean) : [],
						author,
						date,
						message,
						additions: 0,
						deletions: 0,
					};
				});

			const hasMore = allCommits.length > maxCount;
			const commits = hasMore ? allCommits.slice(0, maxCount) : allCommits;

			// Fetch stats in background (optional, non-blocking)
			this.fetchStats(cwd, commits, fetchCount, skip).catch(() => {});

			return { commits, hasMore };
		} catch {
			return { commits: [], hasMore: false };
		}
	}

	private async fetchStats(cwd: string, commits: ICommitEntry[], fetchCount: number, skip: number): Promise<void> {
		try {
			const { stdout: statsRaw } = await execFileAsync(
				'git',
				[
					'log',
					'--format=%H',
					'--shortstat',
					`--max-count=${fetchCount}`,
					`--skip=${skip}`,
					'--topo-order',
					'--all',
				],
				{ cwd, encoding: 'utf-8', timeout: 10000 }
			);

			const statsMap = new Map<string, { additions: number; deletions: number }>();
			let currentHash = '';
			for (const line of statsRaw.trim().split('\n')) {
				const trimmed = line.trim();
				if (!trimmed) {
					continue;
				}
				if (/^[0-9a-f]{40}$/.test(trimmed)) {
					currentHash = trimmed;
				} else if (currentHash && /file.* changed/.test(trimmed)) {
					let additions = 0, deletions = 0;
					const addMatch = trimmed.match(/(\d+) insertion/);
					const delMatch = trimmed.match(/(\d+) deletion/);
					if (addMatch) {
						additions = parseInt(addMatch[1]);
					}
					if (delMatch) {
						deletions = parseInt(delMatch[1]);
					}
					statsMap.set(currentHash, { additions, deletions });
					currentHash = '';
				}
			}

			for (const c of commits) {
				const s = statsMap.get(c.hash);
				if (s) {
					c.additions = s.additions;
					c.deletions = s.deletions;
				}
			}
		} catch {
			// Stats are optional
		}
	}

	async getStatus(): Promise<IGitStatusFile[]> {
		const cwd = this.getCwd();
		if (!cwd) {
			return [];
		}

		try {
			const { stdout } = await execFileAsync(
				'git',
				['status', '--porcelain=v1'],
				{ cwd, encoding: 'utf-8', timeout: 5000 }
			);

			return stdout
				.trim()
				.split('\n')
				.filter(Boolean)
				.map(line => {
					const index = line[0];
					const work = line[1];
					const path = line.substring(3);
					const staged = index !== ' ' && index !== '?';
					const status = staged ? index : work;
					return { status, path, staged };
				});
		} catch {
			return [];
		}
	}

	async getDiff(filePath: string, staged: boolean): Promise<string> {
		const cwd = this.getCwd();
		if (!cwd) {
			return '';
		}

		try {
			const args = staged
				? ['diff', '--cached', '--', filePath]
				: ['diff', '--', filePath];
			const { stdout } = await execFileAsync('git', args, {
				cwd,
				encoding: 'utf-8',
				timeout: 5000,
			});
			return stdout;
		} catch {
			return '';
		}
	}

	async getCurrentBranch(): Promise<string> {
		const cwd = this.getCwd();
		if (!cwd) {
			return '';
		}

		try {
			const { stdout } = await execFileAsync(
				'git',
				['branch', '--show-current'],
				{ cwd, encoding: 'utf-8', timeout: 3000 }
			);
			return stdout.trim();
		} catch {
			return '';
		}
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
