import { spawn } from "node:child_process";
import { ProjectSchema } from "../types";

interface ExecOptions {
  input?: string;
  timeoutMs?: number;
}

export class GhClient {
  private readonly defaultTimeoutMs = 30000;

  private normalizeOwner(owner: string): string {
    const trimmed = owner.trim();
    if (!trimmed) {
      return trimmed;
    }

    if (trimmed.includes("github.com")) {
      try {
        const parsed = new URL(trimmed);
        const firstPathSegment = parsed.pathname.replace(/^\/+/, "").split("/")[0];
        return firstPathSegment || trimmed;
      } catch {
        // no-op: fall through to additional normalization.
      }
    }

    if (trimmed.includes("/")) {
      const firstSegment = trimmed.split("/")[0]?.trim();
      return firstSegment || trimmed;
    }

    return trimmed;
  }

  private isOwnerResolutionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return (
      message.includes("unknown owner type") ||
      message.includes("could not resolve to a node") ||
      message.includes("not found")
    );
  }

  private async exec(args: string[], options: ExecOptions = {}): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn("gh", args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill();
        reject(new Error(`gh ${args.join(" ")} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);

        const out = Buffer.concat(stdout).toString("utf8").trim();
        const err = Buffer.concat(stderr).toString("utf8").trim();

        if (code === 0) {
          resolve(out);
          return;
        }

        reject(new Error(`gh ${args.join(" ")} failed (${code}): ${err || out}`));
      });

      if (options.input) {
        child.stdin.write(options.input);
      }
      child.stdin.end();
    });
  }

  private async execJson<T>(args: string[], options: ExecOptions = {}): Promise<T> {
    const output = await this.exec(args, options);
    return JSON.parse(output) as T;
  }

  async authStatus(): Promise<{ ok: boolean; output: string }> {
    try {
      const output = await this.exec(["auth", "status"]);
      return { ok: true, output };
    } catch (error) {
      return { ok: false, output: (error as Error).message };
    }
  }

  async authLoginWithOauth(scopes: string[]): Promise<void> {
    const scopeArg = scopes.join(",");
    await this.exec([
      "auth",
      "login",
      "--hostname",
      "github.com",
      "--web",
      "--git-protocol",
      "https",
      "--scopes",
      scopeArg
    ], { timeoutMs: 180000 });
  }

  async authRefreshScopes(scopes: string[]): Promise<void> {
    const scopeArg = scopes.join(",");
    await this.exec([
      "auth",
      "refresh",
      "-h",
      "github.com",
      "-s",
      scopeArg
    ], { timeoutMs: 180000 });
  }

  async getProjectItems(owner: string, projectNumber: number, limit: number): Promise<{ items: unknown[] }> {
    const normalizedOwner = this.normalizeOwner(owner);
    const ownerCandidates = Array.from(new Set([normalizedOwner, "@me"].filter(Boolean)));
    let lastError: unknown;

    for (const candidate of ownerCandidates) {
      try {
        return await this.execJson<{ items: unknown[] }>([
          "project",
          "item-list",
          String(projectNumber),
          "--owner",
          candidate,
          "--limit",
          String(limit),
          "--format",
          "json"
        ]);
      } catch (error) {
        lastError = error;
        if (!this.isOwnerResolutionError(error)) {
          throw error;
        }
      }
    }

    try {
      return await this.execJson<{ items: unknown[] }>([
        "project",
        "item-list",
        String(projectNumber),
        "--limit",
        String(limit),
        "--format",
        "json"
      ]);
    } catch (error) {
      if (lastError) {
        throw lastError;
      }
      throw error;
    }
  }

  async getProjectSchema(owner: string, projectNumber: number): Promise<ProjectSchema> {
    const query = [
      "query($owner:String!, $num:Int!) {",
      "  repositoryOwner(login:$owner) {",
      "    __typename",
      "    ... on User {",
      "      projectV2(number:$num) {",
      "        id",
      "        fields(first:100) {",
      "          nodes {",
      "            __typename",
      "            ... on ProjectV2FieldCommon { id name }",
      "            ... on ProjectV2SingleSelectField { options { id name } }",
      "          }",
      "        }",
      "      }",
      "    }",
      "    ... on Organization {",
      "      projectV2(number:$num) {",
      "        id",
      "        fields(first:100) {",
      "          nodes {",
      "            __typename",
      "            ... on ProjectV2FieldCommon { id name }",
      "            ... on ProjectV2SingleSelectField { options { id name } }",
      "          }",
      "        }",
      "      }",
      "    }",
      "  }",
      "}"
    ].join("\n");

    const payload = await this.execJson<{
      data: {
        repositoryOwner: {
          __typename: string;
          projectV2?: {
            id: string;
            fields: {
              nodes: Array<{ id?: string; name?: string; options?: Array<{ id: string; name: string }> }>;
            };
          } | null;
        };
      };
    }>([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `owner=${owner}`,
      "-F",
      `num=${projectNumber}`
    ]);

    const project = payload.data.repositoryOwner?.projectV2;
    if (!project) {
      throw new Error(`Project #${projectNumber} was not found for owner '${owner}'.`);
    }
    const fields = (project.fields.nodes || [])
      .filter((field) => typeof field.id === "string" && typeof field.name === "string")
      .map((field) => ({
        id: field.id as string,
        name: field.name as string,
        options: Array.isArray(field.options) ? field.options : []
      }));

    return {
      projectId: project.id,
      fields
    };
  }

  async getRunList(repo: string, limit: number): Promise<unknown[]> {
    return await this.execJson<unknown[]>([
      "run",
      "list",
      "-R",
      repo,
      "--limit",
      String(limit),
      "--json",
      "databaseId,displayTitle,event,headBranch,status,conclusion,workflowName,createdAt,updatedAt,url,number,name"
    ]);
  }

  async getRunJobs(repo: string, runId: number): Promise<{ jobs: unknown[]; url: string }> {
    return await this.execJson<{ jobs: unknown[]; url: string }>([
      "run",
      "view",
      String(runId),
      "-R",
      repo,
      "--json",
      "jobs,url"
    ]);
  }

  async getRunLog(repo: string, runId: number): Promise<string> {
    return await this.exec([
      "run",
      "view",
      String(runId),
      "-R",
      repo,
      "--log"
    ], { timeoutMs: 120000 });
  }

  async retryRun(repo: string, runId: number, failedOnly: boolean): Promise<void> {
    const args = [
      "run",
      "rerun",
      String(runId),
      "-R",
      repo
    ];
    if (failedOnly) {
      args.push("--failed");
    }
    await this.exec(args);
  }

  async getPullRequests(repo: string, limit: number, state = "open"): Promise<unknown[]> {
    return await this.execJson<unknown[]>([
      "pr",
      "list",
      "-R",
      repo,
      "--limit",
      String(limit),
      "--state",
      state,
      "--json",
      "id,number,title,state,isDraft,headRefName,baseRefName,reviewDecision,author,updatedAt,createdAt,url"
    ]);
  }

  async getPullRequestReviews(repo: string, number: number): Promise<unknown[]> {
    return await this.execJson<unknown[]>([
      "api",
      `repos/${repo}/pulls/${number}/reviews`,
      "-f",
      "per_page=100"
    ]);
  }

  async getPullRequestReviewComments(repo: string, number: number): Promise<unknown[]> {
    return await this.execJson<unknown[]>([
      "api",
      `repos/${repo}/pulls/${number}/comments`,
      "-f",
      "per_page=100"
    ]);
  }

  async getRepositoryLabels(repo: string): Promise<string[]> {
    try {
      const labels = await this.execJson<Array<{ name?: unknown }>>([
        "label",
        "list",
        "-R",
        repo,
        "--limit",
        "200",
        "--json",
        "name"
      ]);
      return labels
        .map((entry) => (typeof entry?.name === "string" ? entry.name.trim() : ""))
        .filter((entry) => entry.length > 0)
        .sort((left, right) => left.localeCompare(right));
    } catch {
      const labels = await this.execJson<Array<{ name?: unknown }>>([
        "api",
        `repos/${repo}/labels`,
        "-f",
        "per_page=100"
      ]);
      return labels
        .map((entry) => (typeof entry?.name === "string" ? entry.name.trim() : ""))
        .filter((entry) => entry.length > 0)
        .sort((left, right) => left.localeCompare(right));
    }
  }

  async createIssue(repo: string, title: string, body: string, labels: string[]): Promise<{ url: string | null; number: number | null }> {
    const args = ["issue", "create", "-R", repo, "--title", title, "--body", body];
    for (const label of labels) {
      args.push("--label", label);
    }
    const output = await this.exec(args);
    const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+\/issues\/(\d+)/i);
    if (!urlMatch) {
      return {
        url: null,
        number: null
      };
    }
    const number = Number.parseInt(urlMatch[1], 10);
    return {
      url: urlMatch[0],
      number: Number.isFinite(number) && number > 0 ? number : null
    };
  }

  async updateIssueLabels(repo: string, issueNumber: number, addLabels: string[], removeLabels: string[]): Promise<void> {
    const args = ["issue", "edit", String(issueNumber), "-R", repo];

    for (const label of addLabels) {
      args.push("--add-label", label);
    }

    for (const label of removeLabels) {
      args.push("--remove-label", label);
    }

    await this.exec(args);
  }

  async createPullRequest(params: {
    repo: string;
    title: string;
    body: string;
    base: string;
    head: string;
    draft: boolean;
  }): Promise<void> {
    const args = [
      "pr",
      "create",
      "-R",
      params.repo,
      "--title",
      params.title,
      "--body",
      params.body,
      "--base",
      params.base,
      "--head",
      params.head
    ];
    if (params.draft) {
      args.push("--draft");
    }
    await this.exec(args);
  }

  async updatePullRequest(params: {
    repo: string;
    number: number;
    title?: string;
    body?: string;
    readyForReview?: boolean;
  }): Promise<void> {
    if (params.readyForReview) {
      await this.exec([
        "pr",
        "ready",
        String(params.number),
        "-R",
        params.repo
      ]);
    }

    if (!params.title && !params.body) {
      return;
    }

    const args = ["pr", "edit", String(params.number), "-R", params.repo];
    if (typeof params.title === "string" && params.title.trim().length > 0) {
      args.push("--title", params.title.trim());
    }
    if (typeof params.body === "string") {
      args.push("--body", params.body);
    }
    await this.exec(args);
  }

  async mergePullRequest(params: {
    repo: string;
    number: number;
    method: "merge" | "squash" | "rebase";
    deleteBranch: boolean;
    auto: boolean;
  }): Promise<void> {
    const args = ["pr", "merge", String(params.number), "-R", params.repo];
    if (params.method === "merge") {
      args.push("--merge");
    } else if (params.method === "squash") {
      args.push("--squash");
    } else {
      args.push("--rebase");
    }
    if (params.deleteBranch) {
      args.push("--delete-branch");
    }
    if (params.auto) {
      args.push("--auto");
    }
    await this.exec(args);
  }

  async commentPullRequest(repo: string, number: number, body: string): Promise<void> {
    await this.exec([
      "pr",
      "comment",
      String(number),
      "-R",
      repo,
      "--body",
      body
    ]);
  }

  async updateProjectSingleSelectField(params: {
    itemId: string;
    projectId: string;
    fieldId: string;
    optionId: string;
  }): Promise<void> {
    await this.exec([
      "project",
      "item-edit",
      "--id",
      params.itemId,
      "--project-id",
      params.projectId,
      "--field-id",
      params.fieldId,
      "--single-select-option-id",
      params.optionId
    ]);
  }
}
