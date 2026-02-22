import { spawn } from "node:child_process";
import { ProjectSchema } from "../types";

interface ExecOptions {
  input?: string;
  timeoutMs?: number;
}

export class GhClient {
  private readonly defaultTimeoutMs = 30000;

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

  async getProjectItems(owner: string, projectNumber: number, limit: number): Promise<{ items: unknown[] }> {
    return await this.execJson<{ items: unknown[] }>([
      "project",
      "item-list",
      String(projectNumber),
      "--owner",
      owner,
      "--limit",
      String(limit),
      "--format",
      "json"
    ]);
  }

  async getProjectSchema(owner: string, projectNumber: number): Promise<ProjectSchema> {
    const query = [
      "query($owner:String!, $num:Int!) {",
      "  user(login:$owner) {",
      "    projectV2(number:$num) {",
      "      id",
      "      fields(first:100) {",
      "        nodes {",
      "          __typename",
      "          ... on ProjectV2FieldCommon { id name }",
      "          ... on ProjectV2SingleSelectField { options { id name } }",
      "        }",
      "      }",
      "    }",
      "  }",
      "}"
    ].join("\n");

    const payload = await this.execJson<{
      data: {
        user: {
          projectV2: {
            id: string;
            fields: {
              nodes: Array<{ id?: string; name?: string; options?: Array<{ id: string; name: string }> }>;
            };
          };
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

    const project = payload.data.user.projectV2;
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

  async createIssue(repo: string, title: string, body: string, labels: string[]): Promise<void> {
    const args = ["issue", "create", "-R", repo, "--title", title, "--body", body];
    for (const label of labels) {
      args.push("--label", label);
    }
    await this.exec(args);
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
