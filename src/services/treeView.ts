import * as vscode from 'vscode';
import { WorkspaceService, RepoInfo } from './workspaceService';
import { GitService } from './gitService';

type TreeNode = GroupItem | RepoItem;

export class RepositoryTreeProvider implements vscode.TreeDataProvider<TreeNode> {
	private _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private cachedRepos: RepoInfo[] = [];

	constructor(
		private readonly workspaceService: WorkspaceService,
		private readonly gitService: GitService,
	) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: TreeNode): Promise<TreeNode[]> {
		if (!element) {
			this.cachedRepos = this.workspaceService.getRepositories();

			if (this.cachedRepos.length === 0) {
				return [new RepoItem('No Git repositories found', '', '', false, 0)];
			}

			const groups = new Map<string, RepoInfo[]>();
			const ungrouped: RepoInfo[] = [];

			for (const repo of this.cachedRepos) {
				if (repo.group) {
					const list = groups.get(repo.group) || [];
					list.push(repo);
					groups.set(repo.group, list);
				} else {
					ungrouped.push(repo);
				}
			}

			const items: TreeNode[] = [];

			for (const [groupName, repos] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
				items.push(new GroupItem(groupName, repos.length));
			}

			for (const repo of ungrouped) {
				const status = await this.gitService.getStatus(repo.path);
				items.push(new RepoItem(repo.name, repo.path, status.branch, status.isDirty, status.changedFiles));
			}

			return items;
		}

		if (element instanceof GroupItem) {
			const repos = this.cachedRepos.filter(r => r.group === element.groupName);
			return Promise.all(
				repos.map(async (repo) => {
					const status = await this.gitService.getStatus(repo.path);
					return new RepoItem(repo.name, repo.path, status.branch, status.isDirty, status.changedFiles);
				}),
			);
		}

		return [];
	}
}

class GroupItem extends vscode.TreeItem {
	constructor(
		public readonly groupName: string,
		private readonly repoCount: number,
	) {
		super(groupName, vscode.TreeItemCollapsibleState.Expanded);
		this.description = `${repoCount} repos`;
		this.iconPath = new vscode.ThemeIcon('folder');
		this.contextValue = 'group';
	}
}

class RepoItem extends vscode.TreeItem {
	constructor(
		repoName: string,
		repoPath: string,
		branch: string,
		isDirty: boolean,
		changedFiles: number,
	) {
		super(repoName, vscode.TreeItemCollapsibleState.None);

		if (repoPath) {
			this.description = `${branch} · ${changedFiles > 0 ? `${changedFiles} changed` : 'clean'}`;
			this.tooltip = `${repoName}\nBranch: ${branch}\nChanged files: ${changedFiles}\nPath: ${repoPath}`;
			this.iconPath = isDirty
				? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'))
				: new vscode.ThemeIcon('check', new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'));
			this.contextValue = isDirty ? 'dirtyRepo' : 'cleanRepo';
		}
	}
}
