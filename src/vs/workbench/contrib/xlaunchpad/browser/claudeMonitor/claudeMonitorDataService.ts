/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INativeEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { IClaudeSession, IClaudeProjectUsage, calculateCost } from '../../common/claudeMonitor.js';

export interface IClaudeFileEntry {
	name: string;
	path: URI;
	type: 'file' | 'directory';
	children?: IClaudeFileEntry[];
}

export class ClaudeMonitorDataService {

	private readonly claudeHomeDir: URI;
	private readonly projectsDir: URI;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
	) {
		this.claudeHomeDir = URI.joinPath(environmentService.userHome, '.claude');
		this.projectsDir = URI.joinPath(this.claudeHomeDir, 'projects');
	}

	/**
	 * Scan all project directories under ~/.claude/projects/ and aggregate usage.
	 */
	async getUsageSummary(): Promise<IClaudeProjectUsage[]> {
		const results: IClaudeProjectUsage[] = [];

		try {
			const stat = await this.fileService.resolve(this.projectsDir);
			if (stat.children) {
				for (const child of stat.children) {
					if (!child.isDirectory) {
						continue;
					}
					const name = child.name;
					const usage = await this.parseProjectUsage(child.resource, name);
					if (usage) {
						results.push(usage);
					}
				}
			}
		} catch {
			// ~/.claude/projects/ may not exist
		}

		// Sort by total cost descending
		results.sort((a, b) => b.totalCost - a.totalCost);
		return results;
	}

	/**
	 * Parse all JSONL files in a single project directory.
	 */
	private async parseProjectUsage(projectDir: URI, projectPath: string): Promise<IClaudeProjectUsage | null> {
		const sessions: IClaudeSession[] = [];

		try {
			const stat = await this.fileService.resolve(projectDir);
			const jsonlChildren = (stat.children ?? [])
				.filter(child => child.isFile && child.name.endsWith('.jsonl'));

			for (const child of jsonlChildren) {
				const filename = child.name;
				try {
					const fileUri = child.resource;
					const content = await this.fileService.readFile(fileUri);
					const text = new TextDecoder().decode(content.value.buffer);
					const session = this.parseJsonlFile(text, filename.replace('.jsonl', ''));
					if (session) {
						sessions.push(session);
					}
				} catch {
					// Skip unreadable files
				}
			}
		} catch {
			return null;
		}

		if (sessions.length === 0) {
			return null;
		}

		return {
			projectPath,
			sessions,
			totalInputTokens: sessions.reduce((sum, s) => sum + s.inputTokens, 0),
			totalOutputTokens: sessions.reduce((sum, s) => sum + s.outputTokens, 0),
			totalCost: sessions.reduce((sum, s) => sum + s.cost, 0),
		};
	}

	/**
	 * Parse a single JSONL file to extract token usage.
	 */
	private parseJsonlFile(text: string, sessionId: string): IClaudeSession | null {
		const lines = text.trim().split('\n');

		let inputTokens = 0;
		let outputTokens = 0;
		let cacheReadTokens = 0;
		let cacheCreationTokens = 0;
		let model = '';
		let timestamp = '';

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type !== 'assistant' || !entry.message?.usage) {
					continue;
				}

				const usage = entry.message.usage;
				const m = entry.message.model || '';
				if (m) {
					model = m;
				}
				if (entry.timestamp) {
					timestamp = entry.timestamp;
				}

				inputTokens += usage.input_tokens || 0;
				outputTokens += usage.output_tokens || 0;
				cacheReadTokens += usage.cache_read_input_tokens || 0;
				cacheCreationTokens += usage.cache_creation_input_tokens || 0;
			} catch {
				// Skip malformed lines
			}
		}

		if (inputTokens === 0 && outputTokens === 0) {
			return null;
		}

		return {
			sessionId,
			model,
			inputTokens,
			outputTokens,
			cacheReadTokens,
			cacheCreationTokens,
			cost: calculateCost(model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens),
			timestamp,
		};
	}

	/**
	 * Get file tree of ~/.claude directory.
	 */
	async getFileTree(): Promise<IClaudeFileEntry[]> {
		return this.readDirRecursive(this.claudeHomeDir, 2);
	}

	private async readDirRecursive(dir: URI, maxDepth: number): Promise<IClaudeFileEntry[]> {
		if (maxDepth <= 0) {
			return [];
		}

		const entries: IClaudeFileEntry[] = [];
		try {
			const stat = await this.fileService.resolve(dir);
			const children = [...(stat.children ?? [])];
			// Sort: directories first, then alphabetical
			children.sort((a, b) => {
				if (a.isDirectory && !b.isDirectory) {
					return -1;
				}
				if (!a.isDirectory && b.isDirectory) {
					return 1;
				}
				return a.name.localeCompare(b.name);
			});

			for (const child of children) {
				if (child.name.startsWith('.')) {
					continue; // skip hidden files
				}
				if (child.isDirectory) {
					const subChildren = await this.readDirRecursive(child.resource, maxDepth - 1);
					entries.push({ name: child.name, path: child.resource, type: 'directory', children: subChildren });
				} else {
					entries.push({ name: child.name, path: child.resource, type: 'file' });
				}
			}
		} catch {
			// directory may not exist
		}

		return entries;
	}
}
