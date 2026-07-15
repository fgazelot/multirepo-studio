import * as vscode from 'vscode';
import { RepositoryTreeProvider } from './services/treeView';
import { WorkspaceService } from './services/workspaceService';
import { GitService } from './services/gitService';
import { GitLabService } from './services/gitLabService';
import { ChangeSetService } from './services/changeSetService';

export function activate(context: vscode.ExtensionContext) {
	const workspaceService = new WorkspaceService();
	const gitService = new GitService();
	const gitLabService = new GitLabService(context);
	const changeSetService = new ChangeSetService(gitService, gitLabService, workspaceService);

	const treeProvider = new RepositoryTreeProvider(workspaceService, gitService);
	const treeView = vscode.window.createTreeView('multirepoStudio.repositories', {
		treeDataProvider: treeProvider,
	});

	context.subscriptions.push(
		treeView,

		vscode.commands.registerCommand('multirepoStudio.refresh', () => {
			treeProvider.refresh();
		}),

		vscode.commands.registerCommand('multirepoStudio.publishChangeSet', () => {
			changeSetService.publish();
		}),

		vscode.commands.registerCommand('multirepoStudio.configureGitLab', () => {
			gitLabService.configureToken();
		}),

		vscode.commands.registerCommand('multirepoStudio.retryFailedMRs', () => {
			changeSetService.retryFailedMergeRequests();
		}),

		vscode.commands.registerCommand('multirepoStudio.switchAllToDefault', () => {
			changeSetService.switchAllToDefault();
		}),
	);

	let refreshTimer: NodeJS.Timeout | undefined;
	const debouncedRefresh = () => {
		if (refreshTimer) { clearTimeout(refreshTimer); }
		refreshTimer = setTimeout(() => treeProvider.refresh(), 2000);
	};

	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	watcher.onDidChange(debouncedRefresh);
	watcher.onDidCreate(debouncedRefresh);
	watcher.onDidDelete(debouncedRefresh);
	context.subscriptions.push(watcher);
}

export function deactivate() {}
