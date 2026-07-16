import * as vscode from 'vscode';
import { GitService } from './gitService';
import { PlatformService, PlatformType, detectPlatform } from './platformService';
import { WorkspaceService, RepoInfo } from './workspaceService';
import { DashboardPanel, DashboardEntry } from './dashboardPanel';

interface ChangeSet {
	branchName: string;
	commitMessage: string;
	mrTitle: string;
	mrDescription: string;
	targetBranchOverride: string | null;
	isDraft: boolean;
	notificationDescription: string;
	reviewTime: string;
	reviewCount: string;
}

interface NotificationConfig {
	enabled: boolean;
	template: string;
	separator: string;
	promptReviewTime: boolean;
	promptReviewCount: boolean;
	defaultReviewTime: string;
	defaultReviewCount: string;
}

type RepoResultStatus = 'success' | 'pushed_mr_failed' | 'git_failed' | 'blocked';

interface RepoResult {
	repo: RepoInfo;
	status: RepoResultStatus;
	mrUrl?: string;
	mrIid?: number;
	platform?: PlatformType;
	error?: string;
}

const DEFAULT_BRANCHES = ['main', 'master', 'develop'];
const HISTORY_KEY = 'multirepoStudio.changeSetHistory';
const MAX_HISTORY = 20;

export interface ChangeSetHistoryEntry {
	title: string;
	branchName: string;
	isDraft: boolean;
	publishedAt: string;
	repos: DashboardEntry[];
}

export class ChangeSetService {
	private lastFailedMrResults: RepoResult[] = [];
	private lastChangeSet: ChangeSet | undefined;
	private lastDashboardEntries: DashboardEntry[] = [];
	private platforms: Map<PlatformType, PlatformService>;

	constructor(
		private readonly git: GitService,
		platforms: PlatformService[],
		private readonly workspace: WorkspaceService,
		private readonly context: vscode.ExtensionContext,
	) {
		this.platforms = new Map(platforms.map(p => [p.type, p]));
	}

	private getHistory(): ChangeSetHistoryEntry[] {
		return this.context.workspaceState.get<ChangeSetHistoryEntry[]>(HISTORY_KEY, []);
	}

	private async saveToHistory(entry: ChangeSetHistoryEntry): Promise<void> {
		const history = this.getHistory();
		history.unshift(entry);
		if (history.length > MAX_HISTORY) { history.length = MAX_HISTORY; }
		await this.context.workspaceState.update(HISTORY_KEY, history);
	}

	async showHistory(): Promise<void> {
		const history = this.getHistory();
		if (history.length === 0) {
			vscode.window.showInformationMessage('No Change Set history yet.');
			return;
		}

		const items = history.map((entry, index) => {
			const date = new Date(entry.publishedAt);
			const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
			const repoCount = entry.repos.length;
			const draftTag = entry.isDraft ? ' [Draft]' : '';
			return {
				label: `${entry.title}${draftTag}`,
				description: `${entry.branchName} — ${repoCount} repo(s)`,
				detail: `${dateStr} — ${entry.repos.map(r => r.repoName).join(', ')}`,
				index,
			};
		});

		const selected = await vscode.window.showQuickPick(items, {
			title: `Change Set History (${history.length})`,
			placeHolder: 'Select a Change Set to open its dashboard',
		});

		if (!selected) { return; }

		const entry = history[selected.index];
		DashboardPanel.open(this.platforms, this.git, entry.repos);
	}

	private getPlatform(type: PlatformType): PlatformService {
		const platform = this.platforms.get(type);
		if (!platform) {
			throw new Error(`No ${type} provider configured`);
		}
		return platform;
	}

	private async getPlatformForRepo(repoPath: string): Promise<{ platform: PlatformService; type: PlatformType } | null> {
		const remoteUrl = await this.git.getRemoteUrl(repoPath);
		if (!remoteUrl) { return null; }
		const type = detectPlatform(remoteUrl);
		return { platform: this.getPlatform(type), type };
	}

	private getNotificationConfig(): NotificationConfig {
		const config = vscode.workspace.getConfiguration('multirepoStudio.notificationTemplate');
		return {
			enabled: config.get('enabled', false),
			template: config.get('template', '[{repo}]\n{description}\n{mrUrl}\n\nTemps de relecture :hourglass_flowing_sand: : {reviewTime}\nNombre de relecture :white_check_mark: : {reviewCount}'),
			separator: config.get('separator', '\n\n---\n\n'),
			promptReviewTime: config.get('promptReviewTime', true),
			promptReviewCount: config.get('promptReviewCount', true),
			defaultReviewTime: config.get('defaultReviewTime', '5m'),
			defaultReviewCount: config.get('defaultReviewCount', '1'),
		};
	}

	openDashboard(): void {
		if (this.lastDashboardEntries.length === 0) {
			vscode.window.showInformationMessage('No Change Set published yet. Publish a Change Set first to see the dashboard.');
			return;
		}
		DashboardPanel.open(this.platforms, this.git, this.lastDashboardEntries);
	}

	async switchAllToDefault(): Promise<void> {
		const repos = this.workspace.getRepositories();
		if (repos.length === 0) {
			vscode.window.showWarningMessage('No Git repositories found in this workspace.');
			return;
		}

		type SwitchInfo = { repo: RepoInfo; currentBranch: string; defaultBranch: string; dirty: boolean };
		const notOnDefault: SwitchInfo[] = [];

		for (const repo of repos) {
			const status = await this.git.getStatus(repo.path);
			const defaultBranch = await this.git.getDefaultBranch(repo.path);
			if (status.branch !== defaultBranch && !status.isDetached) {
				notOnDefault.push({
					repo,
					currentBranch: status.branch,
					defaultBranch,
					dirty: status.isDirty,
				});
			}
		}

		if (notOnDefault.length === 0) {
			vscode.window.showInformationMessage('All repositories are already on their default branch.');
			return;
		}

		const dirtyRepos = notOnDefault.filter(r => r.dirty);

		const details = notOnDefault.map(r =>
			`  • ${r.repo.name}: ${r.currentBranch} → ${r.defaultBranch}${r.dirty ? ' ⚠ uncommitted changes → will be stashed' : ''}`
		).join('\n');

		const warning = dirtyRepos.length > 0
			? `\n\n${dirtyRepos.length} repo(s) have uncommitted changes — they will be stashed automatically (git stash). You can recover them later with "git stash pop".`
			: '';

		const confirm = await vscode.window.showInformationMessage(
			`Switch ${notOnDefault.length} repo(s) to their default branch?${warning}`,
			{ modal: true, detail: details },
			'Switch All',
		);

		if (confirm !== 'Switch All') { return; }

		type SwitchResult = { name: string; success: boolean; from: string; to: string; stashed: boolean; error?: string };
		const results: SwitchResult[] = [];

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Switching to default branches',
				cancellable: false,
			},
			async (progress) => {
				for (const info of notOnDefault) {
					progress.report({ message: info.repo.name });
					try {
						let stashed = false;
						if (info.dirty) {
							await this.git.stashChanges(info.repo.path, `MultiRepo Studio: auto-stash from ${info.currentBranch}`);
							stashed = true;
						}
						await this.git.switchBack(info.repo.path, info.defaultBranch);
						results.push({ name: info.repo.name, success: true, from: info.currentBranch, to: info.defaultBranch, stashed });
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						results.push({ name: info.repo.name, success: false, from: info.currentBranch, to: info.defaultBranch, stashed: false, error: msg });
					}
				}
			},
		);

		const ok = results.filter(r => r.success);
		const ko = results.filter(r => !r.success);
		const stashed = results.filter(r => r.stashed);

		const panel = vscode.window.createOutputChannel('MultiRepo Studio');
		panel.clear();
		panel.appendLine('Switch to default branches\n');
		if (ok.length > 0) {
			panel.appendLine(`✓ ${ok.length} switched:`);
			for (const r of ok) {
				const stashNote = r.stashed ? ' (changes stashed)' : '';
				panel.appendLine(`  ${r.name}: ${r.from} → ${r.to}${stashNote}`);
			}
		}
		if (stashed.length > 0) {
			panel.appendLine(`\n💾 ${stashed.length} repo(s) had changes stashed. To recover:`);
			for (const r of stashed) {
				panel.appendLine(`  cd ${r.name} && git switch ${r.from} && git stash pop`);
			}
		}
		if (ko.length > 0) {
			panel.appendLine(`\n✗ ${ko.length} failed:`);
			for (const r of ko) { panel.appendLine(`  ${r.name} — ${r.error}`); }
		}
		panel.show();

		const msg = stashed.length > 0
			? `${ok.length} repo(s) switched. ${stashed.length} had changes stashed.`
			: `${ok.length} repo(s) switched to default branch.`;
		vscode.window.showInformationMessage(msg);
	}

	async publish(): Promise<void> {
		const repos = this.workspace.getRepositories();
		if (repos.length === 0) {
			vscode.window.showWarningMessage('No Git repositories found in this workspace.');
			return;
		}

		const platformsNeeded = new Set<PlatformType>();
		for (const repo of repos) {
			const remoteUrl = await this.git.getRemoteUrl(repo.path);
			if (remoteUrl) {
				platformsNeeded.add(detectPlatform(remoteUrl));
			}
		}

		for (const type of platformsNeeded) {
			const platform = this.getPlatform(type);
			const token = await platform.getToken();
			if (!token) {
				const label = type === 'github' ? 'GitHub' : 'GitLab';
				const action = await vscode.window.showWarningMessage(
					`${label} token not configured.`,
					`Configure ${label} Token`,
				);
				if (action) {
					await platform.configureToken();
				}
				return;
			}
		}

		const dirtyRepos = await this.getDirtyRepos(repos);
		if (dirtyRepos.length === 0) {
			vscode.window.showInformationMessage('No repositories have changes to publish.');
			return;
		}

		const onFeatureBranch: { repo: RepoInfo; branch: string }[] = [];
		const onDefaultBranch: RepoInfo[] = [];

		for (const repo of dirtyRepos) {
			const status = await this.git.getStatus(repo.path);
			if (!status.isDetached && !DEFAULT_BRANCHES.includes(status.branch)) {
				onFeatureBranch.push({ repo, branch: status.branch });
			} else {
				onDefaultBranch.push(repo);
			}
		}

		if (onFeatureBranch.length > 0 && onDefaultBranch.length === 0) {
			await this.pushToExisting(onFeatureBranch);
			return;
		}

		if (onFeatureBranch.length > 0 && onDefaultBranch.length > 0) {
			const featureNames = onFeatureBranch.map(r => `${r.repo.name} (${r.branch})`).join(', ');
			const defaultNames = onDefaultBranch.map(r => r.name).join(', ');

			const choice = await vscode.window.showQuickPick(
				[
					{
						label: '$(arrow-up) Push to existing branches',
						description: featureNames,
						value: 'existing' as const,
					},
					{
						label: '$(git-branch) Create new Change Set',
						description: `All ${dirtyRepos.length} dirty repos`,
						value: 'new' as const,
					},
				],
				{
					title: 'Some repos are already on a feature branch',
					placeHolder: `On feature branch: ${featureNames} | On default branch: ${defaultNames}`,
				},
			);

			if (!choice) { return; }

			if (choice.value === 'existing') {
				await this.pushToExisting(onFeatureBranch);
				return;
			}
		}

		const changeSet = await this.promptChangeSet(dirtyRepos);
		if (!changeSet) { return; }

		const confirm = await this.confirmPublish(dirtyRepos, changeSet);
		if (!confirm) { return; }

		await this.executePublish(dirtyRepos, changeSet);
	}

	private async pushToExisting(repos: { repo: RepoInfo; branch: string }[]): Promise<void> {
		const branches = [...new Set(repos.map(r => r.branch))];
		const repoList = repos.map(r => `  • ${r.repo.name} (${r.branch})`).join('\n');

		const commitMessage = await vscode.window.showInputBox({
			title: `Push to existing branch${branches.length > 1 ? 'es' : ''}: ${branches.join(', ')}`,
			prompt: `Repos:\n${repoList}`,
			placeHolder: 'e.g. fix: address review feedback',
			ignoreFocusOut: true,
		});
		if (!commitMessage) { return; }

		const confirm = await vscode.window.showInformationMessage(
			`Push new commit to ${repos.length} repo(s)?`,
			{ modal: true },
			'Push',
		);
		if (confirm !== 'Push') { return; }

		type PushResult = { repo: RepoInfo; success: boolean; branch: string; error?: string };
		const results: PushResult[] = [];

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Pushing to existing branches',
				cancellable: false,
			},
			async (progress) => {
				const tasks = repos.map(async ({ repo, branch }) => {
					progress.report({ message: repo.name });
					try {
						await this.git.addAll(repo.path);
						await this.git.commit(repo.path, commitMessage);
						await this.git.push(repo.path, branch);
						results.push({ repo, success: true, branch });
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						results.push({ repo, success: false, branch, error: msg });
					}
				});
				await Promise.all(tasks);
			},
		);

		const ok = results.filter(r => r.success);
		const ko = results.filter(r => !r.success);

		const panel = vscode.window.createOutputChannel('MultiRepo Studio');
		panel.clear();
		panel.appendLine(`Push to existing Change Set: "${commitMessage}"\n`);
		if (ok.length > 0) {
			panel.appendLine(`✓ ${ok.length} pushed:`);
			for (const r of ok) { panel.appendLine(`  ${r.repo.name} → ${r.branch}`); }
		}
		if (ko.length > 0) {
			panel.appendLine(`\n✗ ${ko.length} failed:`);
			for (const r of ko) { panel.appendLine(`  ${r.repo.name} — ${r.error}`); }
		}
		panel.show();

		if (ko.length > 0) {
			vscode.window.showWarningMessage(`${ok.length} pushed, ${ko.length} failed. See Output.`);
		} else {
			vscode.window.showInformationMessage(`${ok.length} repo(s) pushed successfully.`);
		}
	}

	async retryFailedMergeRequests(): Promise<void> {
		if (this.lastFailedMrResults.length === 0 || !this.lastChangeSet) {
			vscode.window.showInformationMessage('Nothing to retry.');
			return;
		}

		const changeSet = this.lastChangeSet;
		const failed = this.lastFailedMrResults;

		const items = failed.map(r => ({
			label: `${r.repo.group ? r.repo.group + '/' : ''}${r.repo.name}`,
			description: this.isTransientError(r.error || '') ? '(transient — will auto-retry)' : '(permanent error)',
			detail: r.error || 'Unknown error',
			picked: true,
			result: r,
		}));

		const selected = await vscode.window.showQuickPick(items, {
			title: `Retry failed MR/PRs (${failed.length} failed)`,
			placeHolder: 'Uncheck repos you don\'t want to retry',
			canPickMany: true,
		});

		if (!selected || selected.length === 0) { return; }

		const toRetry = selected.map(s => s.result);
		this.lastFailedMrResults = failed.filter(r => !toRetry.includes(r));

		const results: RepoResult[] = [];

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Retrying MR/PR creation',
				cancellable: false,
			},
			async (progress) => {
				const tasks = toRetry.map(async (prev) => {
					progress.report({ message: prev.repo.name });

					const remoteUrl = await this.git.getRemoteUrl(prev.repo.path);
					if (!remoteUrl) {
						results.push({ ...prev, error: 'No remote URL' });
						return;
					}

					const type = detectPlatform(remoteUrl);
					const platform = this.getPlatform(type);
					const targetBranch = changeSet.targetBranchOverride || await this.git.getDefaultBranch(prev.repo.path);

					const result = await this.createMrWithRetry(
						platform, type, remoteUrl, prev.repo, changeSet, targetBranch,
					);
					results.push(result);
				});

				await Promise.all(tasks);
			},
		);

		this.showResults(results, changeSet);
	}

	private isTransientError(error: string): boolean {
		return /\b(429|5\d{2}|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|rate limit)/i.test(error);
	}

	private async createMrWithRetry(
		platform: PlatformService,
		type: PlatformType,
		remoteUrl: string,
		repo: RepoInfo,
		changeSet: ChangeSet,
		targetBranch: string,
		maxAttempts = 3,
	): Promise<RepoResult> {
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const pr = await platform.createPullRequest(
					remoteUrl,
					changeSet.branchName,
					targetBranch,
					changeSet.mrTitle,
					changeSet.mrDescription,
					changeSet.isDraft,
				);
				return { repo, status: 'success', mrUrl: pr.url, mrIid: pr.id, platform: type };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (attempt < maxAttempts && this.isTransientError(message)) {
					const delay = 1000 * Math.pow(2, attempt - 1);
					await new Promise(resolve => setTimeout(resolve, delay));
					continue;
				}
				return { repo, status: 'pushed_mr_failed', platform: type, error: message };
			}
		}
		return { repo, status: 'pushed_mr_failed', platform: type, error: 'Max retries exceeded' };
	}

	private async getDirtyRepos(repos: RepoInfo[]): Promise<RepoInfo[]> {
		const statuses = await Promise.all(
			repos.map(async (repo) => {
				const status = await this.git.getStatus(repo.path);
				return { repo, status };
			}),
		);

		return statuses.filter(({ status }) => status.isDirty).map(({ repo }) => repo);
	}

	private async promptChangeSet(dirtyRepos: RepoInfo[]): Promise<ChangeSet | undefined> {
		const repoNames = dirtyRepos.map(r => r.name).join(', ');
		const notifConfig = this.getNotificationConfig();

		const totalSteps = 6
			+ (notifConfig.enabled ? 1 : 0)
			+ (notifConfig.enabled && notifConfig.promptReviewTime ? 1 : 0)
			+ (notifConfig.enabled && notifConfig.promptReviewCount ? 1 : 0);

		let step = 0;

		const title = await vscode.window.showInputBox({
			title: `Change Set — Title (${++step}/${totalSteps})`,
			prompt: `Repositories with changes: ${repoNames}`,
			placeHolder: 'e.g. Upgrade Prometheus 2.52',
			ignoreFocusOut: true,
		});
		if (!title) { return undefined; }

		const branchName = await vscode.window.showInputBox({
			title: `Change Set — Branch Name (${++step}/${totalSteps})`,
			prompt: 'Branch to create in each repository',
			value: this.slugify(title),
			ignoreFocusOut: true,
		});
		if (!branchName) { return undefined; }

		const commitMessage = await vscode.window.showInputBox({
			title: `Change Set — Commit Message (${++step}/${totalSteps})`,
			prompt: 'Commit message for all repositories',
			value: title.startsWith('chore') || title.startsWith('feat') || title.startsWith('fix')
				? title
				: `chore: ${title.toLowerCase()}`,
			ignoreFocusOut: true,
		});
		if (!commitMessage) { return undefined; }

		const mrDescription = await vscode.window.showInputBox({
			title: `Change Set — Description (${++step}/${totalSteps})`,
			prompt: 'Pull/Merge Request description (optional)',
			placeHolder: 'Describe the change...',
			ignoreFocusOut: true,
		});
		if (mrDescription === undefined) { return undefined; }

		const targetBranchInput = await vscode.window.showInputBox({
			title: `Change Set — Target Branch (${++step}/${totalSteps})`,
			prompt: 'Leave "auto" to detect each repo\'s default branch (main/master), or type a branch name to override all',
			value: 'auto',
			ignoreFocusOut: true,
		});
		if (targetBranchInput === undefined) { return undefined; }
		const targetBranchOverride = targetBranchInput === 'auto' || targetBranchInput === '' ? null : targetBranchInput;

		const draftChoice = await vscode.window.showQuickPick(
			[
				{ label: '$(circle-slash) Ready for review', description: 'Create a regular MR/PR', value: false },
				{ label: '$(edit) Draft', description: 'Mark as work-in-progress (not mergeable yet)', value: true },
			],
			{
				title: `Change Set — Draft? (${++step}/${totalSteps})`,
				placeHolder: 'Should this MR/PR be created as a draft?',
			},
		);
		if (!draftChoice) { return undefined; }
		const isDraft = draftChoice.value;

		let notificationDescription = title;
		let reviewTime = notifConfig.defaultReviewTime;
		let reviewCount = notifConfig.defaultReviewCount;

		if (notifConfig.enabled) {
			const desc = await vscode.window.showInputBox({
				title: `Change Set — Notification Description (${++step}/${totalSteps})`,
				prompt: 'Description for the notification message',
				value: title,
				ignoreFocusOut: true,
			});
			if (desc === undefined) { return undefined; }
			notificationDescription = desc || title;

			if (notifConfig.promptReviewTime) {
				const rt = await vscode.window.showInputBox({
					title: `Change Set — Review Time (${++step}/${totalSteps})`,
					prompt: 'Estimated review time',
					value: notifConfig.defaultReviewTime,
					placeHolder: '1m, 5m, 10m, 30m...',
					ignoreFocusOut: true,
				});
				if (rt === undefined) { return undefined; }
				reviewTime = rt || notifConfig.defaultReviewTime;
			}

			if (notifConfig.promptReviewCount) {
				const rc = await vscode.window.showInputBox({
					title: `Change Set — Reviewers Needed (${++step}/${totalSteps})`,
					prompt: 'Number of reviewers needed',
					value: notifConfig.defaultReviewCount,
					placeHolder: '1, 2, 3...',
					ignoreFocusOut: true,
				});
				if (rc === undefined) { return undefined; }
				reviewCount = rc || notifConfig.defaultReviewCount;
			}
		}

		return {
			branchName,
			commitMessage,
			mrTitle: title,
			mrDescription: mrDescription || title,
			targetBranchOverride,
			isDraft,
			notificationDescription,
			reviewTime,
			reviewCount,
		};
	}

	private async confirmPublish(repos: RepoInfo[], changeSet: ChangeSet): Promise<boolean> {
		const summary = repos.map(r => `  • ${r.name}`).join('\n');
		const targetLabel = changeSet.targetBranchOverride || 'auto (per repo)';
		const draftLabel = changeSet.isDraft ? '\nMode: Draft (work-in-progress)' : '';
		const message = `Publish Change Set to ${repos.length} repo(s)?\n\n${summary}\n\nBranch: ${changeSet.branchName}\nTarget: ${targetLabel}${draftLabel}`;

		const result = await vscode.window.showInformationMessage(
			message,
			{ modal: true },
			'Publish',
		);

		return result === 'Publish';
	}

	private async executePublish(repos: RepoInfo[], changeSet: ChangeSet): Promise<void> {
		const reposWithExistingBranch: RepoInfo[] = [];
		for (const repo of repos) {
			if (await this.git.branchExists(repo.path, changeSet.branchName)) {
				reposWithExistingBranch.push(repo);
			}
		}

		let deleteBranches = false;
		if (reposWithExistingBranch.length > 0) {
			const names = reposWithExistingBranch.map(r => r.name).join(', ');
			const choice = await vscode.window.showQuickPick(
				[
					{
						label: '$(trash) Delete and recreate',
						description: `Delete branch "${changeSet.branchName}" in ${reposWithExistingBranch.length} repo(s)`,
						value: 'delete' as const,
					},
					{
						label: '$(close) Skip these repos',
						description: 'Only publish to repos without the branch',
						value: 'skip' as const,
					},
				],
				{
					title: `Branch "${changeSet.branchName}" already exists in: ${names}`,
					placeHolder: 'How should we handle existing branches?',
				},
			);

			if (!choice) { return; }
			deleteBranches = choice.value === 'delete';
		}

		const results: RepoResult[] = [];

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Publishing Change Set',
				cancellable: false,
			},
			async (progress) => {
				const total = repos.length;

				const tasks = repos.map(async (repo, index) => {
					progress.report({
						message: `${repo.name} (${index + 1}/${total})`,
						increment: 100 / total,
					});

					const result = await this.publishToRepo(repo, changeSet, deleteBranches);
					results.push(result);
				});

				await Promise.all(tasks);
			},
		);

		this.lastChangeSet = changeSet;
		this.showResults(results, changeSet);
	}

	private async publishToRepo(repo: RepoInfo, changeSet: ChangeSet, deleteBranches = false): Promise<RepoResult> {
		const status = await this.git.getStatus(repo.path);

		if (status.hasConflicts) {
			return { repo, status: 'blocked', error: 'Repository has merge conflicts' };
		}
		if (status.isRebasing) {
			return { repo, status: 'blocked', error: 'Rebase in progress' };
		}
		if (status.isDetached) {
			return { repo, status: 'blocked', error: 'Detached HEAD state' };
		}

		const branchExists = await this.git.branchExists(repo.path, changeSet.branchName);
		if (branchExists && !deleteBranches) {
			return { repo, status: 'blocked', error: `Branch "${changeSet.branchName}" already exists` };
		}

		const originalBranch = status.branch;

		if (branchExists) {
			try {
				await this.git.deleteRemoteBranch(repo.path, changeSet.branchName);
				if (status.branch === changeSet.branchName) {
					const defaultBranch = await this.git.getDefaultBranch(repo.path);
					await this.git.switchBack(repo.path, defaultBranch);
				}
				await this.git.deleteBranch(repo.path, changeSet.branchName);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { repo, status: 'git_failed', error: `Failed to delete existing branch: ${msg}` };
			}
		}

		try {
			await this.git.switchCreateBranch(repo.path, changeSet.branchName);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { repo, status: 'git_failed', error: `Branch creation failed: ${msg}` };
		}

		try {
			await this.git.addAll(repo.path);
			await this.git.commit(repo.path, changeSet.commitMessage);
			await this.git.push(repo.path, changeSet.branchName);
		} catch (err) {
			await this.git.switchBack(repo.path, originalBranch);
			const msg = err instanceof Error ? err.message : String(err);
			return { repo, status: 'git_failed', error: `Git failed: ${msg}` };
		}

		const remoteUrl = await this.git.getRemoteUrl(repo.path);
		if (!remoteUrl) {
			return { repo, status: 'pushed_mr_failed', error: 'Pushed OK but no remote URL — cannot create MR/PR' };
		}

		const type = detectPlatform(remoteUrl);
		const platform = this.getPlatform(type);
		const targetBranch = changeSet.targetBranchOverride || await this.git.getDefaultBranch(repo.path);

		const result = await this.createMrWithRetry(platform, type, remoteUrl, repo, changeSet, targetBranch);
		if (result.status === 'pushed_mr_failed') {
			result.error = `Pushed OK but MR/PR failed: ${result.error}`;
		}
		return result;
	}

	private showResults(results: RepoResult[], changeSet: ChangeSet): void {
		const succeeded = results.filter(r => r.status === 'success');
		const pushedButMrFailed = results.filter(r => r.status === 'pushed_mr_failed');
		const gitFailed = results.filter(r => r.status === 'git_failed');
		const blocked = results.filter(r => r.status === 'blocked');

		const prLabel = (r: RepoResult) => r.platform === 'github' ? 'PR' : 'MR';
		const draftTag = changeSet.isDraft ? ' [Draft]' : '';

		const lines: string[] = [`Change Set: ${changeSet.mrTitle}${draftTag}`, ''];

		if (succeeded.length > 0) {
			lines.push(`✓ ${succeeded.length} fully succeeded:`);
			for (const r of succeeded) {
				lines.push(`  ${r.repo.name} — ${prLabel(r)} #${r.mrIid} → ${r.mrUrl}`);
			}
		}

		if (pushedButMrFailed.length > 0) {
			lines.push('', `⚠ ${pushedButMrFailed.length} pushed but ${prLabel(pushedButMrFailed[0])} creation failed:`);
			for (const r of pushedButMrFailed) {
				lines.push(`  ${r.repo.name} — ${r.error}`);
			}
			lines.push('', '  → Run "MultiRepo Studio: Retry Failed Merge Requests" to retry.');
		}

		if (gitFailed.length > 0) {
			lines.push('', `✗ ${gitFailed.length} git operations failed:`);
			for (const r of gitFailed) {
				lines.push(`  ${r.repo.name} — ${r.error}`);
			}
		}

		if (blocked.length > 0) {
			lines.push('', `⊘ ${blocked.length} blocked (not attempted):`);
			for (const r of blocked) {
				lines.push(`  ${r.repo.name} — ${r.error}`);
			}
		}

		const notifConfig = this.getNotificationConfig();
		if (notifConfig.enabled && succeeded.length > 0) {
			const messages = succeeded.map(r =>
				notifConfig.template
					.replace(/\{repo\}/g, r.repo.name)
					.replace(/\{mrUrl\}/g, r.mrUrl || '')
					.replace(/\{mrIid\}/g, String(r.mrIid || ''))
					.replace(/\{description\}/g, changeSet.notificationDescription)
					.replace(/\{reviewTime\}/g, changeSet.reviewTime)
					.replace(/\{reviewCount\}/g, changeSet.reviewCount)
			);
			const fullMessage = messages.join(notifConfig.separator);

			lines.push('', '═══════════════════════════════════════════');
			lines.push('Notification message (copied to clipboard):', '');
			lines.push(fullMessage);

			vscode.env.clipboard.writeText(fullMessage);
		}

		const panel = vscode.window.createOutputChannel('MultiRepo Studio');
		panel.clear();
		panel.appendLine(lines.join('\n'));
		panel.show();

		this.lastFailedMrResults = pushedButMrFailed;

		if (succeeded.length > 0) {
			this.lastDashboardEntries = succeeded.map(r => ({
				repoName: r.repo.name,
				group: r.repo.group,
				repoPath: r.repo.path,
				platform: r.platform!,
				mrId: r.mrIid!,
				mrUrl: r.mrUrl!,
				isDraft: changeSet.isDraft,
			}));
			DashboardPanel.open(this.platforms, this.git, this.lastDashboardEntries);
			this.saveToHistory({
				title: changeSet.mrTitle,
				branchName: changeSet.branchName,
				isDraft: changeSet.isDraft,
				publishedAt: new Date().toISOString(),
				repos: this.lastDashboardEntries,
			});
		}

		if (pushedButMrFailed.length > 0) {
			vscode.window.showWarningMessage(
				`${succeeded.length} MR/PR(s) created, ${pushedButMrFailed.length} pushed but MR/PR failed.`,
				'Retry',
			).then(action => {
				if (action === 'Retry') {
					this.retryFailedMergeRequests();
				}
			});
		} else if (gitFailed.length > 0 || blocked.length > 0) {
			vscode.window.showWarningMessage(
				`${succeeded.length} OK, ${gitFailed.length + blocked.length} failed. See Output.`,
			);
		} else if (succeeded.length > 0) {
			for (const r of succeeded) {
				if (r.mrUrl) {
					vscode.env.openExternal(vscode.Uri.parse(r.mrUrl));
				}
			}
			const msg = notifConfig.enabled
				? `Change Set published: ${succeeded.length} MR/PR(s) created. Message copied to clipboard.`
				: `Change Set published: ${succeeded.length} MR/PR(s) created. Links in Output panel.`;
			vscode.window.showInformationMessage(msg);
		}
	}

	private slugify(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	}
}
