import * as vscode from 'vscode';
import { PlatformService, PullRequestResponse, MRStatusResponse, PipelineStatus, MRState, parseRemoteUrl, httpRequest } from './platformService';

interface GitHubPRResponse {
	number: number;
	html_url: string;
	title: string;
	state: string;
	draft: boolean;
	head: { sha: string };
}

interface GitHubCheckRunsResponse {
	total_count: number;
	check_runs: { status: string; conclusion: string | null }[];
}

export class GitHubService implements PlatformService {
	readonly type = 'github' as const;
	private static readonly SECRET_KEY = 'multirepoStudio.githubToken';

	constructor(private readonly context: vscode.ExtensionContext) {}

	async configureToken(): Promise<void> {
		const token = await vscode.window.showInputBox({
			prompt: 'Enter your GitHub Personal Access Token (scope: repo)',
			password: true,
			placeHolder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
			ignoreFocusOut: true,
		});

		if (token) {
			await this.context.secrets.store(GitHubService.SECRET_KEY, token);
			vscode.window.showInformationMessage('MultiRepo Studio: GitHub token saved.');
		}
	}

	async getToken(): Promise<string | undefined> {
		return this.context.secrets.get(GitHubService.SECRET_KEY);
	}

	async createPullRequest(
		remoteUrl: string,
		sourceBranch: string,
		targetBranch: string,
		title: string,
		description: string,
		draft?: boolean,
	): Promise<PullRequestResponse> {
		const token = await this.getToken();
		if (!token) {
			throw new Error('GitHub token not configured. Run "MultiRepo Studio: Configure GitHub Token".');
		}

		const project = parseRemoteUrl(remoteUrl);
		if (!project) {
			throw new Error(`Cannot parse GitHub remote URL: ${remoteUrl}`);
		}

		const apiPath = `/repos/${project.projectPath}/pulls`;

		const body = JSON.stringify({
			head: sourceBranch,
			base: targetBranch,
			title,
			body: description,
			draft: draft || false,
		});

		const response = await httpRequest<GitHubPRResponse>(
			'api.github.com',
			apiPath,
			'POST',
			{
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}`,
				'Accept': 'application/vnd.github+json',
				'User-Agent': 'MultiRepo-Studio-VSCode',
				'X-GitHub-Api-Version': '2022-11-28',
			},
			body,
		);

		return {
			id: response.number,
			url: response.html_url,
			title: response.title,
		};
	}

	private get headers(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'Accept': 'application/vnd.github+json',
			'User-Agent': 'MultiRepo-Studio-VSCode',
			'X-GitHub-Api-Version': '2022-11-28',
		};
	}

	async getMergeRequestStatus(remoteUrl: string, mrId: number): Promise<MRStatusResponse> {
		const token = await this.getToken();
		if (!token) {
			throw new Error('GitHub token not configured.');
		}

		const project = parseRemoteUrl(remoteUrl);
		if (!project) {
			throw new Error(`Cannot parse GitHub remote URL: ${remoteUrl}`);
		}

		const pr = await httpRequest<GitHubPRResponse>(
			'api.github.com',
			`/repos/${project.projectPath}/pulls/${mrId}`,
			'GET',
			{ ...this.headers, 'Authorization': `Bearer ${token}` },
		);

		let pipelineStatus: PipelineStatus = 'unknown';
		let pipelineUrl: string | undefined;

		try {
			const checks = await httpRequest<GitHubCheckRunsResponse>(
				'api.github.com',
				`/repos/${project.projectPath}/commits/${pr.head.sha}/check-runs`,
				'GET',
				{ ...this.headers, 'Authorization': `Bearer ${token}` },
			);

			if (checks.total_count > 0) {
				const runs = checks.check_runs;
				const anyRunning = runs.some(r => r.status !== 'completed');
				const anyFailed = runs.some(r => r.conclusion === 'failure' || r.conclusion === 'cancelled');
				const allSuccess = runs.every(r => r.conclusion === 'success' || r.conclusion === 'skipped' || r.conclusion === 'neutral');

				if (anyRunning) { pipelineStatus = 'running'; }
				else if (anyFailed) { pipelineStatus = 'failed'; }
				else if (allSuccess) { pipelineStatus = 'passed'; }

				pipelineUrl = `${pr.html_url}/checks`;
			}
		} catch {
			pipelineStatus = 'unknown';
		}

		const state: MRState = pr.state === 'closed' ? 'closed' : 'open';

		return {
			mrId: pr.number,
			mrUrl: pr.html_url,
			mrTitle: pr.title,
			state,
			isDraft: pr.draft,
			pipeline: { status: pipelineStatus, url: pipelineUrl },
		};
	}
}
