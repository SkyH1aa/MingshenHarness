import { setTimeout as delay } from "node:timers/promises";
import type { GitHubConnectionStatus } from "../../shared/domain";
import type { ManagedPolicyService } from "../policy/managed-policy-service";
import type { Repository } from "../storage/repository";
import { maskSecret, type SecretStore } from "../storage/secret-store";

interface GitHubRepository {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  updated_at?: string;
}

interface GitHubSearchResponse {
  total_count?: number;
  items?: GitHubRepository[];
}

interface GitHubUser {
  login?: string;
  name?: string | null;
  avatar_url?: string | null;
}

interface GitHubConnectionRecord {
  secretRef: string;
  maskedHint: string;
  login: string;
  displayName: string | null;
  avatarUrl: string | null;
}

const CONNECTION_SETTING = "github.connection";

export class GitHubService {
  private managedPolicy: ManagedPolicyService | null = null;
  private startingAuthorization: AbortController | null = null;
  private deviceFlow: {
    deviceCode: string;
    userCode: string;
    verificationUrl: string;
    expiresAt: number;
    interval: number;
    nextPoll: number;
    clientId: string;
    controller: AbortController;
  } | null = null;
  private polling = false;
  constructor(
    private readonly repository: Repository,
    private readonly secretStore: SecretStore,
  ) {}

  setManagedPolicy(policy: ManagedPolicyService | null): void {
    this.managedPolicy = policy;
  }

  async startDeviceAuthorization(
    clientId: string,
  ): Promise<{ userCode: string; verificationUrl: string; expiresAt: number }> {
    if (!/^[a-zA-Z0-9._-]{5,150}$/.test(clientId.trim()))
      throw new Error(
        "请输入为 Mingshen 注册且启用 Device Flow 的 GitHub App/OAuth App Client ID。",
      );
    this.assertNetworkAllowed("GitHub 设备授权");
    this.cancelDeviceAuthorization();
    const controller = new AbortController();
    this.startingAuthorization = controller;
    try {
      const response = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ client_id: clientId.trim(), scope: "repo read:user" }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      const data = (await response.json()) as Record<string, unknown>;
      controller.signal.throwIfAborted();
      if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri)
        throw new Error(
          `GitHub 设备授权失败：${String(data.error_description ?? data.error ?? response.status)}`,
        );
      const verification = new URL(String(data.verification_uri));
      if (verification.protocol !== "https:" || verification.hostname !== "github.com")
        throw new Error("GitHub 返回了无效的授权地址。");
      if (typeof data.user_code !== "string" || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(data.user_code))
        throw new Error("GitHub 未返回有效的设备验证码，请重试。");
      const interval = Math.max(5, Number(data.interval) || 5) * 1000;
      const expiresAt =
        Date.now() + Math.min(1800, Math.max(1, Number(data.expires_in) || 900)) * 1000;
      this.deviceFlow = {
        deviceCode: String(data.device_code),
        userCode: data.user_code,
        verificationUrl: verification.toString(),
        clientId: clientId.trim(),
        interval,
        expiresAt,
        nextPoll: Date.now() + interval,
        controller,
      };
      this.repository.setSetting("github.oauthClientId", clientId.trim());
      return {
        userCode: String(data.user_code),
        verificationUrl: verification.toString(),
        expiresAt,
      };
    } finally {
      if (this.startingAuthorization === controller) this.startingAuthorization = null;
    }
  }

  getDeviceAuthorization(): {
    userCode: string;
    verificationUrl: string;
    expiresAt: number;
  } | null {
    const flow = this.deviceFlow;
    if (!flow || Date.now() >= flow.expiresAt) return null;
    return {
      userCode: flow.userCode,
      verificationUrl: flow.verificationUrl,
      expiresAt: flow.expiresAt,
    };
  }

  async pollDeviceAuthorization(): Promise<{
    status: "pending" | "connected";
    connection?: GitHubConnectionStatus;
  }> {
    const flow = this.deviceFlow;
    if (!flow) {
      const connection = await this.getStatus();
      if (connection.configured) return { status: "connected", connection };
    }
    if (!flow || Date.now() >= flow.expiresAt) {
      this.deviceFlow = null;
      throw new Error("GitHub 授权已过期，请重新连接。");
    }
    if (this.polling) {
      await delay(500);
      return { status: "pending" };
    }
    this.polling = true;
    try {
      this.assertNetworkAllowed("GitHub 授权轮询");
      await delay(Math.max(0, flow.nextPoll - Date.now()), undefined, {
        signal: flow.controller.signal,
      });
      if (this.deviceFlow !== flow) throw new Error("GitHub 授权已取消。");
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: flow.clientId,
          device_code: flow.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
        signal: AbortSignal.any([flow.controller.signal, AbortSignal.timeout(30_000)]),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (this.deviceFlow !== flow) throw new Error("GitHub 授权已取消。");
      if (response.ok && typeof data.access_token === "string") {
        const connection = await this.setToken(data.access_token, flow.controller.signal);
        this.deviceFlow = null;
        return { status: "connected", connection };
      }
      if (data.error === "slow_down") flow.interval += 5000;
      flow.nextPoll = Date.now() + flow.interval;
      if (response.ok && ["authorization_pending", "slow_down"].includes(String(data.error)))
        return { status: "pending" };
      this.deviceFlow = null;
      throw new Error(
        `GitHub 授权失败：${String(data.error_description ?? data.error ?? response.status)}`,
      );
    } finally {
      this.polling = false;
    }
  }

  cancelDeviceAuthorization(): void {
    this.startingAuthorization?.abort();
    this.startingAuthorization = null;
    this.deviceFlow?.controller.abort();
    this.deviceFlow = null;
  }

  tokenForMcp(): string | null {
    return this.getToken();
  }

  async getStatus(): Promise<GitHubConnectionStatus> {
    const connection = this.getConnectionRecord();
    if (!connection) {
      return {
        configured: false,
        maskedHint: null,
        login: null,
        displayName: null,
        avatarUrl: null,
      };
    }
    return {
      configured: true,
      maskedHint: connection.maskedHint,
      login: connection.login,
      displayName: connection.displayName,
      avatarUrl: connection.avatarUrl,
    };
  }

  async setToken(token: string, signal?: AbortSignal): Promise<GitHubConnectionStatus> {
    const normalized = token.trim();
    if (!normalized) {
      throw new Error("GitHub Token 不能为空。");
    }
    const user = await this.request<GitHubUser>("/user", {}, normalized);
    signal?.throwIfAborted();
    if (!user.login) {
      throw new Error("GitHub Token 验证失败，未返回用户信息。");
    }
    const stored = this.secretStore.store(normalized);
    const previous = this.getConnectionRecord();
    const connection: GitHubConnectionRecord = {
      secretRef: stored.secretRef,
      maskedHint: maskSecret(normalized),
      login: user.login,
      displayName: user.name ?? null,
      avatarUrl: user.avatar_url ?? null,
    };
    this.repository.setSetting(CONNECTION_SETTING, connection);
    if (previous?.secretRef && previous.secretRef !== stored.secretRef) {
      this.secretStore.remove(previous.secretRef);
    }
    return await this.getStatus();
  }

  async disconnect(): Promise<void> {
    this.cancelDeviceAuthorization();
    const previous = this.getConnectionRecord();
    this.repository.removeSetting(CONNECTION_SETTING);
    if (previous?.secretRef) {
      this.secretStore.remove(previous.secretRef);
    }
  }

  async searchRepositories(
    query: string,
    limit = 8,
  ): Promise<{ output: string; isError: boolean }> {
    const normalized = query.trim();
    if (!normalized) {
      return { output: "GitHub 搜索关键词不能为空。", isError: true };
    }
    try {
      this.assertNetworkAllowed("GitHub 仓库搜索");
      const payload = await this.request<GitHubSearchResponse>(
        `/search/repositories?q=${encodeURIComponent(normalized)}&sort=stars&order=desc&per_page=${Math.min(Math.max(limit, 1), 20)}`,
      );
      const items = (payload.items ?? []).slice(0, limit);
      if (items.length === 0) {
        return { output: `GitHub 没有找到与“${normalized}”匹配的仓库。`, isError: false };
      }
      return {
        output: [
          `GitHub 搜索结果：${payload.total_count ?? items.length} 个仓库`,
          "",
          ...items.map(
            (item, index) =>
              `${index + 1}. ${item.full_name ?? "(unknown)"}\n   ${item.description || "无描述"}\n   ${item.language || "Unknown"} · ${item.stargazers_count ?? 0} stars\n   ${item.html_url ?? ""}`,
          ),
        ].join("\n"),
        isError: false,
      };
    } catch (error) {
      return this.errorResult("搜索仓库", error);
    }
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ output: string; isError: boolean }> {
    try {
      this.assertNetworkAllowed(`GitHub 工具 ${toolName}`);
      switch (toolName) {
        case "github_search_repositories":
          return await this.searchRepositories(
            typeof args.query === "string" ? args.query : "",
            typeof args.limit === "number" ? args.limit : 8,
          );
        case "github_list_pull_requests": {
          const repo = requireString(args.repo, "repo");
          const state = args.state === "closed" || args.state === "all" ? args.state : "open";
          const pulls = await this.request<Array<Record<string, unknown>>>(
            `/repos/${repo}/pulls?state=${state}&per_page=30`,
          );
          return {
            output: pulls.length
              ? pulls
                  .map(
                    (pull) =>
                      `#${pull.number} ${pull.title}\n   ${pull.state} · ${pull.user && typeof pull.user === "object" ? String((pull.user as Record<string, unknown>).login ?? "") : ""}\n   ${pull.html_url}`,
                  )
                  .join("\n\n")
              : `仓库 ${repo} 没有 ${state} 状态的 Pull Request。`,
            isError: false,
          };
        }
        case "github_get_pull_request": {
          const repo = requireString(args.repo, "repo");
          const number = requireNumber(args.number, "number");
          const pull = await this.request<Record<string, unknown>>(
            `/repos/${repo}/pulls/${number}`,
          );
          return { output: this.formatPullRequest(repo, number, pull), isError: false };
        }
        case "github_list_issues": {
          const repo = requireString(args.repo, "repo");
          const state = args.state === "closed" || args.state === "all" ? args.state : "open";
          const issues = await this.request<Array<Record<string, unknown>>>(
            `/repos/${repo}/issues?state=${state}&per_page=30`,
          );
          const filtered = issues.filter((issue) => !issue.pull_request);
          return {
            output: filtered.length
              ? filtered
                  .map(
                    (issue) =>
                      `#${issue.number} ${issue.title}\n   ${issue.state} · ${issue.comments ?? 0} comments\n   ${issue.html_url}`,
                  )
                  .join("\n\n")
              : `仓库 ${repo} 没有 ${state} 状态的 Issue。`,
            isError: false,
          };
        }
        case "github_list_workflow_runs": {
          const repo = requireString(args.repo, "repo");
          const result = await this.request<{ workflow_runs?: Array<Record<string, unknown>> }>(
            `/repos/${repo}/actions/runs?per_page=20`,
          );
          const runs = result.workflow_runs ?? [];
          return {
            output: runs.length
              ? runs
                  .map(
                    (run) =>
                      `${run.name ?? "Workflow"} · ${run.status ?? "unknown"} / ${run.conclusion ?? "pending"}\n   ${run.head_branch ?? ""} · ${run.created_at ?? ""}\n   ${run.html_url ?? ""}`,
                  )
                  .join("\n\n")
              : `仓库 ${repo} 没有 GitHub Actions 运行记录。`,
            isError: false,
          };
        }
        case "github_create_issue": {
          const repo = requireString(args.repo, "repo");
          const title = requireString(args.title, "title");
          const body = typeof args.body === "string" ? args.body : "";
          const issue = await this.request<Record<string, unknown>>(`/repos/${repo}/issues`, {
            method: "POST",
            body: { title, body },
          });
          return {
            output: `已创建 Issue #${issue.number}: ${issue.title}\n${issue.html_url}`,
            isError: false,
          };
        }
        case "github_add_pr_comment": {
          const repo = requireString(args.repo, "repo");
          const number = requireNumber(args.number, "number");
          const body = requireString(args.body, "body");
          const comment = await this.request<Record<string, unknown>>(
            `/repos/${repo}/issues/${number}/comments`,
            { method: "POST", body: { body } },
          );
          return {
            output: `已在 PR #${number} 添加评论\n${comment.html_url ?? ""}`,
            isError: false,
          };
        }
        default:
          return { output: `未知 GitHub 工具：${toolName}`, isError: true };
      }
    } catch (error) {
      return this.errorResult("执行 GitHub 操作", error);
    }
  }

  private getConnectionRecord(): GitHubConnectionRecord | null {
    const value = this.repository.getSetting(CONNECTION_SETTING);
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value as Partial<GitHubConnectionRecord>;
    return typeof record.secretRef === "string" &&
      typeof record.maskedHint === "string" &&
      typeof record.login === "string"
      ? (record as GitHubConnectionRecord)
      : null;
  }

  private getToken(): string | null {
    const connection = this.getConnectionRecord();
    return connection ? this.secretStore.read(connection.secretRef) : null;
  }

  private async request<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
    } = {},
    tokenOverride?: string,
  ): Promise<T> {
    this.assertNetworkAllowed("GitHub API 请求");
    const token = tokenOverride ?? this.getToken();
    if (!token && (init.method ?? "GET") !== "GET") {
      throw new Error("该 GitHub 写操作需要先连接 GitHub Token。");
    }
    const response = await fetch(`https://api.github.com${path}`, {
      method: init.method ?? "GET",
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "Mingshen-Harness",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `GitHub 请求失败：HTTP ${response.status} ${response.statusText}${detail ? `\n${detail.slice(0, 600)}` : ""}`,
      );
    }
    return (await response.json()) as T;
  }

  private formatPullRequest(repo: string, number: number, pull: Record<string, unknown>): string {
    return [
      `PR #${number} · ${String(pull.title ?? "")}`,
      `${repo} · ${String(pull.state ?? "")} · ${String(pull.user && typeof pull.user === "object" ? ((pull.user as Record<string, unknown>).login ?? "") : "")}`,
      String(pull.html_url ?? ""),
      "",
      String(pull.body ?? "(无描述)"),
    ].join("\n");
  }

  private errorResult(action: string, error: unknown): { output: string; isError: boolean } {
    return {
      output: `${action}失败：${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }

  private assertNetworkAllowed(operation: string): void {
    this.managedPolicy?.assertOperational(operation);
    this.managedPolicy?.assertCapability("network.request", { approved: true });
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`缺少 ${field}。`);
  }
  return value.trim();
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} 必须是正整数。`);
  }
  return value;
}
