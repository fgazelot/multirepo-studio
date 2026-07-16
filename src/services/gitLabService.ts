import * as vscode from 'vscode';
import { PlatformService, PullRequestResponse, MRStatusResponse, PipelineStatus, MRState, parseRemoteUrl, httpRequest } from './platformService';

interface GitLabMRResponse {
	iid: number;
	web_url: string;
	title: string;
	state: string;
	draft: boolean;
	head_pipeline?: {
		id: number;
		status: string;
		web_url: string;
	} | null;
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
		draft?: boolean,
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

		const mrTitle = draft ? `Draft: ${title}` : title;

		const body = JSON.stringify({
			source_branch: sourceBranch,
			target_branch: targetBranch,
			title: mrTitle,
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

	async getMergeRequestStatus(remoteUrl: string, mrId: number): Promise<MRStatusResponse> {
		const token = await this.getToken();
		if (!token) {
			throw new Error('GitLab token not configured.');
		}

		const project = parseRemoteUrl(remoteUrl);
		if (!project) {
			throw new Error(`Cannot parse GitLab remote URL: ${remoteUrl}`);
		}

		const encodedPath = encodeURIComponent(project.projectPath);
		const mr = await httpRequest<GitLabMRResponse>(
			project.host,
			`/api/v4/projects/${encodedPath}/merge_requests/${mrId}`,
			'GET',
			{ 'PRIVATE-TOKEN': token },
		);

		let pipelineStatus: PipelineStatus = 'unknown';
		let pipelineUrl: string | undefined;

		if (mr.head_pipeline) {
			const glStatus = mr.head_pipeline.status;
			if (glStatus === 'success') { pipelineStatus = 'passed'; }
			else if (glStatus === 'failed') { pipelineStatus = 'failed'; }
			else if (glStatus === 'running' || glStatus === 'created' || glStatus === 'waiting_for_resource' || glStatus === 'preparing') { pipelineStatus = 'running'; }
			else if (glStatus === 'pending') { pipelineStatus = 'pending'; }
			else if (glStatus === 'canceled') { pipelineStatus = 'cancelled'; }
			pipelineUrl = mr.head_pipeline.web_url;
		}

		const stateMap: Record<string, MRState> = { opened: 'open', merged: 'merged', closed: 'closed' };
		const state: MRState = stateMap[mr.state] || 'open';

		return {
			mrId: mr.iid,
			mrUrl: mr.web_url,
			mrTitle: mr.title,
			state,
			isDraft: mr.draft,
			pipeline: { status: pipelineStatus, url: pipelineUrl },
		};
	}
}
