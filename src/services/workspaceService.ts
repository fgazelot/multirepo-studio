import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface RepoInfo {
	name: string;
	path: string;
	group: string;
	workspaceFolder: vscode.WorkspaceFolder;
}

const MAX_SCAN_DEPTH = 3;

export class WorkspaceService {
	getRepositories(): RepoInfo[] {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders) {
			return [];
		}

		const repos: RepoInfo[] = [];

		for (const folder of folders) {
			this.scanForRepos(folder.uri.fsPath, folder, repos, 0, folder.name);
		}

		repos.sort((a, b) => {
			const groupCmp = a.group.localeCompare(b.group);
			if (groupCmp !== 0) { return groupCmp; }
			return a.name.localeCompare(b.name);
		});

		return repos;
	}

	private scanForRepos(
		dir: string,
		workspaceFolder: vscode.WorkspaceFolder,
		repos: RepoInfo[],
		depth: number,
		group: string,
	): void {
		if (depth > MAX_SCAN_DEPTH) { return; }

		if (fs.existsSync(path.join(dir, '.git'))) {
			const parentDir = path.basename(path.dirname(dir));
			const repoName = path.basename(dir);
			repos.push({
				name: repoName,
				path: dir,
				group: depth === 0 ? '' : parentDir,
				workspaceFolder,
			});
			return;
		}

		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) { continue; }
			if (entry.name === 'node_modules' || entry.name === '.git') { continue; }
			this.scanForRepos(
				path.join(dir, entry.name),
				workspaceFolder,
				repos,
				depth + 1,
				depth === 0 ? entry.name : group,
			);
		}
	}
}
