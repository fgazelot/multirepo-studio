import * as vscode from 'vscode';
import { RepositoryTreeProvider } from './services/treeView';
import { WorkspaceService } from './services/workspaceService';
import { GitService } from './services/gitService';
import { GitLabService } from './services/gitLabService';
import { GitHubService } from './services/gitHubService';
import { ChangeSetService } from './services/changeSetService';
import { SearchService } from './services/searchService';
import { RepoInfo } from './services/workspaceService';

export function activate(context: vscode.ExtensionContext) {
	const workspaceService = new WorkspaceService();
	const gitService = new GitService();
	const gitLabService = new GitLabService(context);
	const gitHubService = new GitHubService(context);
	const changeSetService = new ChangeSetService(gitService, [gitLabService, gitHubService], workspaceService);
	const searchService = new SearchService();

	const treeProvider = new RepositoryTreeProvider(workspaceService, gitService);
	const treeView = vscode.window.createTreeView('multirepoStudio.repositories', {
		treeDataProvider: treeProvider,
	});

	const SELECTED_REPOS_KEY = 'multirepoStudio.selectedRepos';

	async function pickRepos(): Promise<RepoInfo[] | undefined> {
		const repos = workspaceService.getRepositories();
		if (repos.length === 0) {
			vscode.window.showWarningMessage('No Git repositories found in this workspace.');
			return undefined;
		}

		const previousSelection: string[] = context.workspaceState.get(SELECTED_REPOS_KEY, []);

		const items = repos.map(repo => {
			const label = repo.name;
			const description = repo.group || '';
			const picked = previousSelection.length === 0 || previousSelection.includes(repo.path);
			return { label, description, picked, repo };
		});

		const selected = await vscode.window.showQuickPick(items, {
			title: 'Select repositories to search',
			placeHolder: 'Check the repos you want to include (your selection is remembered)',
			canPickMany: true,
			matchOnDescription: true,
		});

		if (!selected || selected.length === 0) { return undefined; }

		await context.workspaceState.update(
			SELECTED_REPOS_KEY,
			selected.map(s => s.repo.path),
		);

		return selected.map(s => s.repo);
	}

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

		vscode.commands.registerCommand('multirepoStudio.configureGitHub', () => {
			gitHubService.configureToken();
		}),

		vscode.commands.registerCommand('multirepoStudio.retryFailedMRs', () => {
			changeSetService.retryFailedMergeRequests();
		}),

		vscode.commands.registerCommand('multirepoStudio.switchAllToDefault', () => {
			changeSetService.switchAllToDefault();
		}),

		vscode.commands.registerCommand('multirepoStudio.discardChanges', async () => {
			const repos = workspaceService.getRepositories();
			if (repos.length === 0) {
				vscode.window.showWarningMessage('No Git repositories found in this workspace.');
				return;
			}

			const dirtyRepos: { repo: RepoInfo; changedFiles: number; branch: string }[] = [];
			for (const repo of repos) {
				const status = await gitService.getStatus(repo.path);
				if (status.isDirty) {
					dirtyRepos.push({ repo, changedFiles: status.changedFiles, branch: status.branch });
				}
			}

			if (dirtyRepos.length === 0) {
				vscode.window.showInformationMessage('All repositories are clean. Nothing to discard.');
				return;
			}

			const details = dirtyRepos.map(r =>
				`  • ${r.repo.group ? r.repo.group + '/' : ''}${r.repo.name} — ${r.changedFiles} file(s) on ${r.branch}`
			).join('\n');

			const choice = await vscode.window.showQuickPick(
				[
					{
						label: '$(trash) Discard all changes',
						description: `Reset ${dirtyRepos.length} repo(s) to clean state`,
						value: 'discard' as const,
					},
					{
						label: '$(git-branch) Save to a new branch first',
						description: 'Commit changes to a new branch, then switch back',
						value: 'save' as const,
					},
				],
				{
					title: `${dirtyRepos.length} repo(s) have uncommitted changes`,
					placeHolder: details,
				},
			);

			if (!choice) { return; }

			if (choice.value === 'save') {
				const branchName = await vscode.window.showInputBox({
					title: 'Save changes to branch',
					prompt: 'Branch name for saving the current changes',
					placeHolder: 'e.g. backup/wip-changes',
					ignoreFocusOut: true,
				});
				if (!branchName) { return; }

				const commitMessage = await vscode.window.showInputBox({
					title: 'Commit message',
					prompt: 'Message for the backup commit',
					value: 'wip: save uncommitted changes',
					ignoreFocusOut: true,
				});
				if (!commitMessage) { return; }

				const confirm = await vscode.window.showInformationMessage(
					`Save changes from ${dirtyRepos.length} repo(s) to branch "${branchName}", then switch back to current branch?`,
					{ modal: true, detail: details },
					'Save & Switch Back',
				);
				if (confirm !== 'Save & Switch Back') { return; }

				type SaveResult = { name: string; success: boolean; originalBranch: string; error?: string };
				const results: SaveResult[] = [];

				await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Saving changes...' },
					async (progress) => {
						for (const { repo, branch } of dirtyRepos) {
							progress.report({ message: repo.name });
							try {
								await gitService.switchCreateBranch(repo.path, branchName);
								await gitService.addAll(repo.path);
								await gitService.commit(repo.path, commitMessage);
								await gitService.switchBack(repo.path, branch);
								results.push({ name: repo.name, success: true, originalBranch: branch });
							} catch (err) {
								const msg = err instanceof Error ? err.message : String(err);
								results.push({ name: repo.name, success: false, originalBranch: branch, error: msg });
							}
						}
					},
				);

				const ok = results.filter(r => r.success);
				const ko = results.filter(r => !r.success);

				const panel = vscode.window.createOutputChannel('MultiRepo Studio');
				panel.clear();
				panel.appendLine(`Saved changes to branch "${branchName}"\n`);
				if (ok.length > 0) {
					panel.appendLine(`✓ ${ok.length} saved and switched back:`);
					for (const r of ok) { panel.appendLine(`  ${r.name} → back on ${r.originalBranch}`); }
				}
				if (ko.length > 0) {
					panel.appendLine(`\n✗ ${ko.length} failed:`);
					for (const r of ko) { panel.appendLine(`  ${r.name} — ${r.error}`); }
				}
				panel.appendLine(`\nTo recover: git switch ${branchName}`);
				panel.show();

				vscode.window.showInformationMessage(`${ok.length} repo(s) saved to "${branchName}" and switched back.`);
			} else {
				const confirm = await vscode.window.showWarningMessage(
					`Discard ALL uncommitted changes in ${dirtyRepos.length} repo(s)? This cannot be undone.`,
					{ modal: true, detail: details },
					'Discard All',
				);
				if (confirm !== 'Discard All') { return; }

				type DiscardResult = { name: string; success: boolean; error?: string };
				const results: DiscardResult[] = [];

				await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Discarding changes...' },
					async (progress) => {
						for (const { repo } of dirtyRepos) {
							progress.report({ message: repo.name });
							try {
								await gitService.discardChanges(repo.path);
								results.push({ name: repo.name, success: true });
							} catch (err) {
								const msg = err instanceof Error ? err.message : String(err);
								results.push({ name: repo.name, success: false, error: msg });
							}
						}
					},
				);

				const ok = results.filter(r => r.success);
				const ko = results.filter(r => !r.success);

				if (ko.length > 0) {
					vscode.window.showWarningMessage(`${ok.length} discarded, ${ko.length} failed.`);
				} else {
					vscode.window.showInformationMessage(`${ok.length} repo(s) cleaned.`);
				}
			}

			treeProvider.refresh();
		}),

		vscode.commands.registerCommand('multirepoStudio.searchAndReplace', async () => {
			const selectedRepos = await pickRepos();
			if (!selectedRepos) { return; }

			const searchTerm = await vscode.window.showInputBox({
				title: `Search in ${selectedRepos.length} repo(s)`,
				prompt: 'Search term (exact match)',
				placeHolder: 'e.g. prometheus_version: "2.51"',
				ignoreFocusOut: true,
			});
			if (!searchTerm) { return; }

			const results = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Searching "${searchTerm}" in ${selectedRepos.length} repo(s)...`,
				},
				() => searchService.searchInRepos(selectedRepos, searchTerm),
			);

			if (results.length === 0) {
				vscode.window.showInformationMessage(`No matches found for "${searchTerm}".`);
				return;
			}

			const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);
			const totalFiles = results.reduce((sum, r) => sum + new Set(r.matches.map(m => m.file)).size, 0);

			const panel = vscode.window.createOutputChannel('MultiRepo Studio — Search');
			panel.clear();
			panel.appendLine(`Search: "${searchTerm}"`);
			panel.appendLine(`Found ${totalMatches} match(es) in ${totalFiles} file(s) across ${results.length} repo(s)\n`);

			for (const result of results) {
				const files = [...new Set(result.matches.map(m => m.file))];
				panel.appendLine(`📁 ${result.repo.group ? result.repo.group + '/' : ''}${result.repo.name} (${result.matches.length} match(es) in ${files.length} file(s))`);
				for (const file of files) {
					const fileMatches = result.matches.filter(m => m.file === file);
					panel.appendLine(`  ${file}`);
					for (const match of fileMatches) {
						panel.appendLine(`    L${match.line}: ${match.content.trim()}`);
					}
				}
				panel.appendLine('');
			}
			panel.show();

			const replaceTerm = await vscode.window.showInputBox({
				title: 'Replace',
				prompt: `Replace "${searchTerm}" with:`,
				placeHolder: 'e.g. prometheus_version: "2.52"',
				ignoreFocusOut: true,
			});
			if (replaceTerm === undefined) { return; }
			if (replaceTerm === '') {
				vscode.window.showInformationMessage('Replacement cancelled (empty value).');
				return;
			}

			const repoList = results.map(r =>
				`  • ${r.repo.group ? r.repo.group + '/' : ''}${r.repo.name} (${r.matches.length} matches)`
			).join('\n');

			const confirm = await vscode.window.showInformationMessage(
				`Replace "${searchTerm}" → "${replaceTerm}" in ${results.length} repo(s)?`,
				{ modal: true, detail: `${totalMatches} replacement(s) in ${totalFiles} file(s):\n${repoList}` },
				'Replace All',
			);
			if (confirm !== 'Replace All') { return; }

			const stats = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Replacing across repos...',
				},
				() => searchService.replaceAcrossRepos(results, searchTerm, replaceTerm),
			);

			panel.appendLine('═══════════════════════════════════════════');
			panel.appendLine(`Replaced: ${stats.replaced} occurrence(s) in ${stats.files} file(s) across ${stats.repos} repo(s)`);
			panel.appendLine('\n→ Run "Publish Change Set" to commit and push these changes.');
			panel.show();

			vscode.window.showInformationMessage(
				`Replaced ${stats.replaced} occurrence(s) in ${stats.repos} repo(s). Run Publish Change Set when ready.`,
			);

			treeProvider.refresh();
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
