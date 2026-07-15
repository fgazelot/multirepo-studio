import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { RepoInfo } from './workspaceService';

const execFileAsync = promisify(execFile);

export interface SearchMatch {
	repo: RepoInfo;
	file: string;
	line: number;
	content: string;
}

export interface RepoSearchResult {
	repo: RepoInfo;
	matches: SearchMatch[];
}

export class SearchService {
	async searchInRepos(repos: RepoInfo[], query: string): Promise<RepoSearchResult[]> {
		if (repos.length === 0) { return []; }

		const results = await Promise.all(
			repos.map(repo => this.searchInRepo(repo, query))
		);

		return results.filter(r => r.matches.length > 0);
	}

	private async searchInRepo(repo: RepoInfo, query: string): Promise<RepoSearchResult> {
		try {
			const { stdout } = await execFileAsync(
				'git', ['grep', '-n', '--fixed-strings', query],
				{ cwd: repo.path, maxBuffer: 10 * 1024 * 1024 },
			);

			const matches: SearchMatch[] = stdout
				.split('\n')
				.filter(l => l.length > 0)
				.map(line => {
					const colonIdx = line.indexOf(':');
					const secondColon = line.indexOf(':', colonIdx + 1);
					return {
						repo,
						file: line.substring(0, colonIdx),
						line: parseInt(line.substring(colonIdx + 1, secondColon), 10),
						content: line.substring(secondColon + 1),
					};
				});

			return { repo, matches };
		} catch {
			return { repo, matches: [] };
		}
	}

	async replaceAcrossRepos(
		searchResults: RepoSearchResult[],
		searchTerm: string,
		replaceTerm: string,
	): Promise<{ replaced: number; files: number; repos: number }> {
		let totalReplaced = 0;
		let totalFiles = 0;
		let totalRepos = 0;

		for (const result of searchResults) {
			const files = [...new Set(result.matches.map(m => m.file))];
			let repoHadChanges = false;

			for (const file of files) {
				const filePath = path.join(result.repo.path, file);
				try {
					const doc = await vscode.workspace.openTextDocument(filePath);
					const text = doc.getText();
					const newText = text.split(searchTerm).join(replaceTerm);

					if (newText !== text) {
						const edit = new vscode.WorkspaceEdit();
						edit.replace(
							doc.uri,
							new vscode.Range(
								doc.positionAt(0),
								doc.positionAt(text.length),
							),
							newText,
						);
						await vscode.workspace.applyEdit(edit);
						await doc.save();

						const count = (text.split(searchTerm).length - 1);
						totalReplaced += count;
						totalFiles++;
						repoHadChanges = true;
					}
				} catch {
					// skip files that can't be opened
				}
			}

			if (repoHadChanges) { totalRepos++; }
		}

		return { replaced: totalReplaced, files: totalFiles, repos: totalRepos };
	}
}
