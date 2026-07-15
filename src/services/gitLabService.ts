import * as vscode from 'vscode';
import { PlatformService, PullRequestResponse, parseRemoteUrl, httpRequest } from './platformService';

interface GitLabMRResponse {
	iid: number;
	web_url: string;
	title: string;
}

export class GitLabService implements PlatformService {
	readonly type = 'gitlab' as const;
	private static readonly SECRET_KEY = 'multirepoStudio.gitlabToken';

	constructor(private readonly context: vscode.ExtensionContext) {}

	async configureToken(): Promise<void> {
		const token = await vscode.window.showInputBox({
			prompt: 'Enter your GitLab Personal Access Token (scope: api)',
			password: true,
			placeHolder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
			ignoreFocusOut: true,
		});

		if (token) {
			await this.context.secrets.store(GitLabService.SECRET_KEY, token);
			vscode.window.showInformationMessage('MultiRepo Studio: GitLab token saved.');
		}
	}

	async getToken(): Promise<string | undefined> {
		return this.context.secrets.get(GitLabService.SECRET_KEY);
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
			throw new Error('GitLab token not configured. Run "MultiRepo Studio: Configure GitLab Token".');
		}

		const project = parseRemoteUrl(remoteUrl);
		if (!project) {
			throw new Error(`Cannot parse GitLab remote URL: ${remoteUrl}`);
		}

		const encodedPath = encodeURIComponent(project.projectPath);
		const apiPath = `/api/v4/projects/${encodedPath}/merge_requests`;

		const body = JSON.stringify({
			source_branch: sourceBranch,
			target_branch: targetBranch,
			title,
			description,
			remove_source_branch: true,
		});

		const response = await httpRequest<GitLabMRResponse>(
			project.host,
			apiPath,
			'POST',
			{
				'Content-Type': 'application/json',
				'PRIVATE-TOKEN': token,
			},
			body,
		);

		return {
			id: response.iid,
			url: response.web_url,
			title: response.title,
		};
	}
}
