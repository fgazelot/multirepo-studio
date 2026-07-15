import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';

interface MergeRequestResponse {
	iid: number;
	web_url: string;
	title: string;
}

interface GitLabProject {
	host: string;
	projectPath: string;
}

export class GitLabService {
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

	parseRemoteUrl(remoteUrl: string): GitLabProject | null {
		// SSH: git@gitlab.com:group/project.git
		const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
		if (sshMatch) {
			return { host: sshMatch[1], projectPath: sshMatch[2] };
		}

		// HTTPS with credentials: https://user:token@gitlab.com/group/project.git
		// HTTPS without credentials: https://gitlab.com/group/project.git
		const httpsMatch = remoteUrl.match(/^https?:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/);
		if (httpsMatch) {
			return { host: httpsMatch[1], projectPath: httpsMatch[2] };
		}

		return null;
	}

	async createMergeRequest(
		remoteUrl: string,
		sourceBranch: string,
		targetBranch: string,
		title: string,
		description: string,
	): Promise<MergeRequestResponse> {
		const token = await this.getToken();
		if (!token) {
			throw new Error('GitLab token not configured. Run "MultiRepo Studio: Configure GitLab Token".');
		}

		const project = this.parseRemoteUrl(remoteUrl);
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

		return this.request<MergeRequestResponse>(project.host, apiPath, token, body);
	}

	private request<T>(host: string, path: string, token: string, body: string): Promise<T> {
		return new Promise((resolve, reject) => {
			const isHttps = !host.includes(':') || host.startsWith('https');
			const mod = isHttps ? https : http;

			const req = mod.request(
				{
					hostname: host.replace(/:\d+$/, ''),
					port: host.match(/:(\d+)$/)?.[1] || (isHttps ? 443 : 80),
					path,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'PRIVATE-TOKEN': token,
						'Content-Length': Buffer.byteLength(body),
					},
				},
				(res) => {
					let data = '';
					res.on('data', (chunk) => (data += chunk));
					res.on('end', () => {
						if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
							resolve(JSON.parse(data));
						} else {
							const errorMsg = (() => {
								try {
									const parsed = JSON.parse(data);
									return parsed.message || parsed.error || data;
								} catch {
									return data;
								}
							})();
							reject(new Error(`GitLab API ${res.statusCode}: ${JSON.stringify(errorMsg)}`));
						}
					});
				},
			);

			req.on('error', reject);
			req.write(body);
			req.end();
		});
	}
}
