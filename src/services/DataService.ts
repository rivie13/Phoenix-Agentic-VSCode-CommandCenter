import * as vscode from "vscode";
import {
  ActionJob,
  ActionRun,
  BoardItem,
  DashboardSnapshot,
  ProjectFieldName,
  ProjectSchema
} from "../types";
import { isNeedsAttention, mapBoardItems } from "../utils/transform";
import { inferPhoenixRepositories, repoUrlToSlug } from "../utils/workspace";
import { GhClient } from "./GhClient";

interface RuntimeSettings {
  owner: string;
  projectNumber: number;
  refreshSeconds: number;
  useSupervisorStream: boolean;
  supervisorBaseUrl: string;
  repositories: string[];
}

export class DataService {
  private readonly gh: GhClient;
  private schemaCacheKey: string | null = null;
  private schemaCache: ProjectSchema | null = null;

  constructor(gh: GhClient) {
    this.gh = gh;
  }

  getSettings(): RuntimeSettings {
    const config = vscode.workspace.getConfiguration("phoenixOps");
    const owner = config.get<string>("projectOwner", "rivie13");
    const projectNumber = config.get<number>("projectNumber", 3);
    const refreshSeconds = Math.max(10, config.get<number>("refreshSeconds", 30));
    const useSupervisorStream = config.get<boolean>("useSupervisorStream", true);
    const supervisorBaseUrl = config.get<string>("supervisorBaseUrl", "http://127.0.0.1:8787");
    const configuredRepos = config.get<string[]>("repositories", []);
    const repositories = configuredRepos.length > 0 ? configuredRepos : inferPhoenixRepositories(owner);

    return {
      owner,
      projectNumber,
      refreshSeconds,
      useSupervisorStream,
      supervisorBaseUrl,
      repositories
    };
  }

  async checkGhAuth(): Promise<{ ok: boolean; output: string }> {
    return await this.gh.authStatus();
  }

  async fetchLocalSnapshot(sequence: number, streamConnected: boolean, stale: boolean): Promise<DashboardSnapshot> {
    const settings = this.getSettings();
    const boardRaw = await this.gh.getProjectItems(settings.owner, settings.projectNumber, 200);
    const boardItems = mapBoardItems(boardRaw.items ?? []);
    const { runs, jobs } = await this.fetchRunsAndJobs(settings.repositories);

    return {
      board: { items: boardItems },
      actions: { runs, jobs },
      meta: {
        generatedAt: new Date().toISOString(),
        sequence,
        source: "local-gh",
        streamConnected,
        stale
      }
    };
  }

  async getFieldOptions(fieldName: ProjectFieldName): Promise<string[]> {
    const settings = this.getSettings();
    const schema = await this.getProjectSchema(settings.owner, settings.projectNumber);
    const field = schema.fields.find((candidate) => candidate.name.toLowerCase() === fieldName.toLowerCase());
    return field?.options.map((option) => option.name) ?? [];
  }

  async updateProjectField(item: BoardItem, fieldName: ProjectFieldName, optionName: string): Promise<void> {
    const settings = this.getSettings();
    const schema = await this.getProjectSchema(settings.owner, settings.projectNumber);

    const field = schema.fields.find((candidate) => candidate.name.toLowerCase() === fieldName.toLowerCase());
    if (!field) {
      throw new Error(`Project field '${fieldName}' was not found on board #${settings.projectNumber}.`);
    }

    const option = field.options.find((candidate) => candidate.name.toLowerCase() === optionName.toLowerCase());
    if (!option) {
      throw new Error(`Option '${optionName}' is invalid for field '${fieldName}'.`);
    }

    await this.gh.updateProjectSingleSelectField({
      itemId: item.itemId,
      projectId: schema.projectId,
      fieldId: field.id,
      optionId: option.id
    });
  }

  async createIssue(repo: string, title: string, body: string, labels: string[]): Promise<void> {
    await this.gh.createIssue(repo, title, body, labels);
  }

  async updateLabels(item: BoardItem, addLabels: string[], removeLabels: string[]): Promise<void> {
    if (!item.issueNumber) {
      throw new Error("Cannot update labels: selected board item has no issue number.");
    }

    const repo = repoUrlToSlug(item.repo);
    await this.gh.updateIssueLabels(repo, item.issueNumber, addLabels, removeLabels);
  }

  private async getProjectSchema(owner: string, projectNumber: number): Promise<ProjectSchema> {
    const key = `${owner}/${projectNumber}`;
    if (this.schemaCache && this.schemaCacheKey === key) {
      return this.schemaCache;
    }

    const schema = await this.gh.getProjectSchema(owner, projectNumber);
    this.schemaCacheKey = key;
    this.schemaCache = schema;
    return schema;
  }

  private async fetchRunsAndJobs(repositories: string[]): Promise<{ runs: ActionRun[]; jobs: ActionJob[] }> {
    const runLists = await Promise.allSettled(repositories.map((repo) => this.gh.getRunList(repo, 40)));
    const runs: ActionRun[] = [];

    runLists.forEach((result, index) => {
      if (result.status !== "fulfilled") {
        return;
      }

      const repo = repositories[index];
      const list = Array.isArray(result.value) ? result.value : [];

      for (const entry of list) {
        if (!entry || typeof entry !== "object") {
          continue;
        }

        const raw = entry as Record<string, unknown>;
        const run: ActionRun = {
          id: Number(raw.databaseId ?? 0),
          repo,
          workflowName: typeof raw.workflowName === "string" ? raw.workflowName : "Workflow",
          name: typeof raw.name === "string" ? raw.name : "",
          displayTitle: typeof raw.displayTitle === "string" ? raw.displayTitle : "",
          status: typeof raw.status === "string" ? raw.status : "unknown",
          conclusion: typeof raw.conclusion === "string" ? raw.conclusion : null,
          event: typeof raw.event === "string" ? raw.event : "",
          headBranch: typeof raw.headBranch === "string" ? raw.headBranch : null,
          createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
          updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
          url: typeof raw.url === "string" ? raw.url : "",
          number: Number(raw.number ?? 0)
        };

        if (run.id > 0) {
          runs.push(run);
        }
      }
    });

    const inspectRuns = runs
      .filter((run) => run.status === "queued" || run.status === "in_progress" || isNeedsAttention(run.conclusion))
      .slice(0, 40);

    const jobs: ActionJob[] = [];
    const jobFetches = await Promise.allSettled(
      inspectRuns.map((run) => this.gh.getRunJobs(run.repo, run.id).then((payload) => ({ run, payload })))
    );

    for (const result of jobFetches) {
      if (result.status !== "fulfilled") {
        continue;
      }

      const { run, payload } = result.value;
      const runJobs = Array.isArray(payload.jobs) ? payload.jobs : [];

      for (const entry of runJobs) {
        if (!entry || typeof entry !== "object") {
          continue;
        }

        const raw = entry as Record<string, unknown>;
        const stepNames: string[] = [];
        const steps = Array.isArray(raw.steps) ? raw.steps : [];

        for (const step of steps) {
          if (!step || typeof step !== "object") {
            continue;
          }
          const rawStep = step as Record<string, unknown>;
          const stepConclusion = typeof rawStep.conclusion === "string" ? rawStep.conclusion : null;
          const stepStatus = typeof rawStep.status === "string" ? rawStep.status : null;
          if (
            (stepConclusion && isNeedsAttention(stepConclusion)) ||
            stepStatus === "in_progress"
          ) {
            const name = typeof rawStep.name === "string" ? rawStep.name : "step";
            stepNames.push(name);
          }
        }

        const jobId = String(raw.databaseId ?? `${run.id}:${String(raw.name ?? "job")}`);

        jobs.push({
          id: `${run.repo}:${run.id}:${jobId}`,
          runId: run.id,
          repo: run.repo,
          runUrl: run.url,
          workflowName: run.workflowName,
          jobName: typeof raw.name === "string" ? raw.name : "job",
          status: typeof raw.status === "string" ? raw.status : "unknown",
          conclusion: typeof raw.conclusion === "string" ? raw.conclusion : null,
          failedSteps: stepNames
        });
      }
    }

    return { runs, jobs };
  }
}
