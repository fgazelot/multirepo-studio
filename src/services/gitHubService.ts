import * as vscode from 'vscode';
import { PlatformService, PullRequestResponse, parseRemoteUrl, httpRequest } from './platformService';

interface GitHubPRResponse {
	number: number;
	html_url: string;
	title: string;
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
}
