import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  ActionJob,
  ActionRun,
  BoardItem,
  DashboardSnapshot,
  PullRequestSummary,
  ProjectFieldName,
  ProjectSchema
} from "../types";
import { isNeedsAttention, mapBoardItems } from "../utils/transform";
import { inferRepositories, RepositoryDiscoveryMode, repoUrlToSlug } from "../utils/workspace";
import { GhClient } from "./GhClient";

export type RefreshReason = "startup" | "manual" | "poll" | "write";

interface RuntimeSettings {
  owner: string;
  projectNumber: number;
  refreshSeconds: number;
  useSupervisorStream: boolean;
  supervisorBaseUrl: string;
  supervisorAuthToken: string;
  workspaceSupervisorAutoStart: boolean;
  workspaceSupervisorRepoPath: string;
  workspaceSupervisorStartTimeoutMs: number;
  allowDirectGhPollingFallback: boolean;
  repositoryDiscoveryMode: RepositoryDiscoveryMode;
  repositories: string[];
  boardCacheSeconds: number;
  actionsCacheSeconds: number;
  pullRequestCacheSeconds: number;
  rateLimitCooldownSeconds: number;
  embeddedSupervisorEnabled: boolean;
  embeddedSupervisorHost: string;
  embeddedSupervisorPort: number;
  embeddedSupervisorApiToken: string;
  codexCliPath: string;
  copilotCliPath: string;
  claudeCliPath: string;
  geminiCliPath: string;
  cliBootstrapOnStartup: boolean;
  cliStartupSpawnPtyTerminals: boolean;
  cliStartupAutoInstallMissing: boolean;
  cliStartupAutoSignIn: boolean;
  codexCliInstallCommand: string;
  copilotCliInstallCommand: string;
  claudeCliInstallCommand: string;
  geminiCliInstallCommand: string;
  codexDefaultModel: string;
  copilotDefaultModel: string;
  copilotCloudEnabled: boolean;
  codexModelOptions: string[];
  copilotModelOptions: string[];
  agentModelCatalogUrl: string;
  agentModelCatalogAuthToken: string;
  jarvisEnabled: boolean;
  jarvisAutoAnnouncements: boolean;
  jarvisApiBaseUrl: string;
  jarvisApiKey: string;
  jarvisTextModel: string;
  jarvisSpeechModel: string;
  jarvisVoice: string;
  jarvisTtsProvider: "gemini-with-fallback" | "gemini" | "pollinations";
  jarvisGeminiApiKey: string;
  jarvisGeminiModel: string;
  jarvisGeminiVoice: string;
  jarvisTtsDebug: boolean;
  jarvisMaxAnnouncementsPerHour: number;
  jarvisMinSecondsBetweenAnnouncements: number;
  jarvisReasonCooldownMinutes: number;
  jarvisPollinationsHardCooldownSeconds: number;
  jarvisPollinationsSoftCooldownSeconds: number;
  jarvisHostPlaybackSpacingMs: number;
  jarvisOfferJokes: boolean;
  jarvisConversationHistoryTurns: number;
}

interface BoardCacheState {
  key: string;
  fetchedAtMs: number;
  items: BoardItem[];
}

interface ActionsCacheState {
  key: string;
  fetchedAtMs: number;
  runs: ActionRun[];
  jobs: ActionJob[];
}

interface PullRequestCacheState {
  key: string;
  fetchedAtMs: number;
  pullRequests: PullRequestSummary[];
}

export interface PullRequestInsightEntry {
  id: string;
  kind: "review" | "comment";
  author: string;
  body: string;
  state: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
  path: string | null;
  line: number | null;
  isCopilot: boolean;
}

export interface PullRequestInsights {
  repo: string;
  number: number;
  reviews: PullRequestInsightEntry[];
  comments: PullRequestInsightEntry[];
  fetchedAt: string;
}

export interface ActionRunLogResult {
  repo: string;
  runId: number;
  text: string;
  truncated: boolean;
  fetchedAt: string;
}

interface PersistedCacheFile {
  version: number;
  savedAt: string;
  boardCache?: BoardCacheState;
  actionsCache?: ActionsCacheState;
  pullRequestCache?: PullRequestCacheState;
}

const ACTIONS_LOOKBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

function stripWrappingQuotes(value: string): string {
  let next = value.trim();
  while (next.length >= 2) {
    const first = next[0];
    const last = next[next.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      next = next.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return next;
}

export class DataService {
  private readonly gh: GhClient;
  private readonly cacheFilePath: string | null;
  private diskCacheLoaded = false;
  private schemaCacheKey: string | null = null;
  private schemaCache: ProjectSchema | null = null;
  private boardCache: BoardCacheState | null = null;
  private actionsCache: ActionsCacheState | null = null;
  private pullRequestCache: PullRequestCacheState | null = null;
  private ghCooldownUntilMs = 0;

  constructor(gh: GhClient, globalStoragePath?: string) {
    this.gh = gh;
    this.cacheFilePath = globalStoragePath
      ? path.join(globalStoragePath, "phoenix-command-center-cache.json")
      : null;
  }

  getSettings(): RuntimeSettings {
    const config = vscode.workspace.getConfiguration("phoenixOps");
    const explicitStringSetting = (setting: string): string | null => {
      const inspected = config.inspect<string>(setting);
      const workspaceFolderValue = inspected?.workspaceFolderValue;
      if (typeof workspaceFolderValue === "string") {
        return workspaceFolderValue;
      }
      const workspaceValue = inspected?.workspaceValue;
      if (typeof workspaceValue === "string") {
        return workspaceValue;
      }
      const globalValue = inspected?.globalValue;
      if (typeof globalValue === "string") {
        return globalValue;
      }
      return null;
    };
    const normalizeStringArraySetting = (value: unknown, fallback: string[]): string[] => {
      const normalized = (Array.isArray(value) ? value : [])
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry.length > 0);
      const deduped = [...new Set(normalized)];
      return deduped.length > 0 ? deduped : [...fallback];
    };
    const owner = config.get<string>("projectOwner", "rivie13");
    const projectNumber = config.get<number>("projectNumber", 3);
    const refreshSeconds = Math.max(10, config.get<number>("refreshSeconds", 30));
    const useSupervisorStream = config.get<boolean>("useSupervisorStream", true);
    const supervisorBaseUrl = config.get<string>("supervisorBaseUrl", "http://127.0.0.1:8787");
    const supervisorAuthToken = config.get<string>("supervisorAuthToken", "").trim();
    const workspaceSupervisorAutoStart = config.get<boolean>("workspaceSupervisorAutoStart", true);
    const workspaceSupervisorRepoPath = config.get<string>("workspaceSupervisorRepoPath", "").trim();
    const workspaceSupervisorStartTimeoutMs = Math.min(
      120_000,
      Math.max(5_000, config.get<number>("workspaceSupervisorStartTimeoutMs", 45_000))
    );
    const allowDirectGhPollingFallback = config.get<boolean>("allowDirectGhPollingFallback", false);
    const repositoryDiscoveryMode = config.get<RepositoryDiscoveryMode>("repositoryDiscoveryMode", "phoenixWorkspace");
    const configuredRepos = config.get<string[]>("repositories", []);
    const repositories = configuredRepos.length > 0 ? configuredRepos : inferRepositories(owner, repositoryDiscoveryMode);
    const boardCacheSeconds = Math.max(15, config.get<number>("boardCacheSeconds", 120));
    const actionsCacheSeconds = Math.max(15, config.get<number>("actionsCacheSeconds", 120));
    const pullRequestCacheSeconds = Math.max(15, config.get<number>("pullRequestCacheSeconds", 120));
    const rateLimitCooldownSeconds = Math.max(30, config.get<number>("rateLimitCooldownSeconds", 300));
    const embeddedSupervisorEnabled = config.get<boolean>("embeddedSupervisorEnabled", false);
    const embeddedSupervisorHost = config.get<string>("embeddedSupervisorHost", "127.0.0.1").trim() || "127.0.0.1";
    const embeddedSupervisorPort = Math.max(1, Math.min(65535, config.get<number>("embeddedSupervisorPort", 8789)));
    const embeddedSupervisorApiToken = config.get<string>("embeddedSupervisorApiToken", "").trim();
    const codexCliPath = stripWrappingQuotes(config.get<string>("codexCliPath", "codex").trim()) || "codex";
    const copilotCliPath = stripWrappingQuotes(config.get<string>("copilotCliPath", "copilot").trim()) || "copilot";
    const claudeCliPath = stripWrappingQuotes(config.get<string>("claudeCliPath", "claude").trim()) || "claude";
    const geminiCliPath = stripWrappingQuotes(config.get<string>("geminiCliPath", "gemini").trim()) || "gemini";
    const cliBootstrapOnStartup = config.get<boolean>("cliBootstrapOnStartup", true);
    const cliStartupSpawnPtyTerminals = config.get<boolean>("cliStartupSpawnPtyTerminals", true);
    const cliStartupAutoInstallMissing = config.get<boolean>("cliStartupAutoInstallMissing", true);
    const cliStartupAutoSignIn = config.get<boolean>("cliStartupAutoSignIn", true);
    const codexCliInstallCommand = stripWrappingQuotes(config.get<string>("codexCliInstallCommand", "npm install -g @openai/codex").trim());
    const copilotCliInstallCommand = stripWrappingQuotes(config.get<string>("copilotCliInstallCommand", "npm install -g @github/copilot").trim());
    const claudeCliInstallCommand = stripWrappingQuotes(config.get<string>("claudeCliInstallCommand", "npm install -g @anthropic-ai/claude-code").trim());
    const geminiCliInstallCommand = stripWrappingQuotes(config.get<string>("geminiCliInstallCommand", "npm install -g @google/gemini-cli").trim());
    const codexDefaultModel = (explicitStringSetting("codexDefaultModel") ?? "").trim();
    const copilotDefaultModel = (explicitStringSetting("copilotDefaultModel") ?? "").trim();
    const copilotCloudEnabled = config.get<boolean>("copilotCloudEnabled", false);
    const codexModelOptions = normalizeStringArraySetting(
      config.get<string[]>("codexModelOptions", []),
      ["gpt-5.3-codex", "gpt-5-codex"]
    );
    const copilotModelOptions = normalizeStringArraySetting(
      config.get<string[]>("copilotModelOptions", []),
      ["gpt-4.1", "claude-sonnet"]
    );
    const agentModelCatalogUrl = (explicitStringSetting("agentModelCatalogUrl") ?? "").trim();
    const agentModelCatalogAuthToken = (explicitStringSetting("agentModelCatalogAuthToken") ?? "").trim();
    const jarvisEnabled = config.get<boolean>("jarvisEnabled", true);
    const jarvisAutoAnnouncements = config.get<boolean>("jarvisAutoAnnouncements", true);
    const jarvisApiKey = (explicitStringSetting("jarvisApiKey") ?? "").trim();
    const jarvisApiBaseUrl = (explicitStringSetting("jarvisApiBaseUrl") ?? "").trim() ||
      (jarvisApiKey ? "https://gen.pollinations.ai" : "https://text.pollinations.ai/openai");
    const jarvisDefaultTextModel = jarvisApiKey ? "openai-large" : "openai";
    const jarvisTextModel = (explicitStringSetting("jarvisTextModel") ?? "").trim() || jarvisDefaultTextModel;
    const jarvisDefaultSpeechModel = jarvisApiKey ? "openai-audio" : "tts-1";
    const configuredJarvisSpeechModel = (explicitStringSetting("jarvisSpeechModel") ?? "").trim() || jarvisDefaultSpeechModel;
    const jarvisSpeechModel = configuredJarvisSpeechModel.toLowerCase().includes("elevenlabs")
      ? jarvisDefaultSpeechModel
      : configuredJarvisSpeechModel;
    const jarvisVoice = config.get<string>("jarvisVoice", "onyx").trim() || "onyx";
    const configuredJarvisTtsProvider = (explicitStringSetting("jarvisTtsProvider") ?? "").trim().toLowerCase();
    const jarvisTtsProvider =
      configuredJarvisTtsProvider === "gemini-with-fallback" ||
      configuredJarvisTtsProvider === "gemini" ||
      configuredJarvisTtsProvider === "pollinations"
        ? configuredJarvisTtsProvider
        : "gemini-with-fallback";
    const jarvisGeminiApiKey = (explicitStringSetting("jarvisGeminiApiKey") ?? "").trim();
    const jarvisGeminiModel = (explicitStringSetting("jarvisGeminiModel") ?? "").trim() || "gemini-2.5-flash-preview-tts";
    const jarvisGeminiVoice = (explicitStringSetting("jarvisGeminiVoice") ?? "").trim() || "Charon";
    const jarvisTtsDebug = config.get<boolean>("jarvisTtsDebug", false);
    const jarvisMaxAnnouncementsPerHour = Math.min(20, Math.max(1, config.get<number>("jarvisMaxAnnouncementsPerHour", 12)));
    const jarvisMinSecondsBetweenAnnouncements = Math.max(30, config.get<number>("jarvisMinSecondsBetweenAnnouncements", 180));
    const jarvisReasonCooldownMinutes = Math.max(5, config.get<number>("jarvisReasonCooldownMinutes", 20));
    const jarvisPollinationsHardCooldownSeconds = Math.min(1800, Math.max(30, config.get<number>("jarvisPollinationsHardCooldownSeconds", 900)));
    const jarvisPollinationsSoftCooldownSeconds = Math.min(1800, Math.max(15, config.get<number>("jarvisPollinationsSoftCooldownSeconds", 120)));
    const jarvisHostPlaybackSpacingMs = Math.max(0, Math.min(10_000, config.get<number>("jarvisHostPlaybackSpacingMs", 600)));
    const jarvisOfferJokes = config.get<boolean>("jarvisOfferJokes", true);
    const jarvisConversationHistoryTurns = Math.min(24, Math.max(2, config.get<number>("jarvisConversationHistoryTurns", 8)));

    return {
      owner,
      projectNumber,
      refreshSeconds,
      useSupervisorStream,
      supervisorBaseUrl,
      supervisorAuthToken,
      workspaceSupervisorAutoStart,
      workspaceSupervisorRepoPath,
      workspaceSupervisorStartTimeoutMs,
      allowDirectGhPollingFallback,
      repositoryDiscoveryMode,
      repositories,
      boardCacheSeconds,
      actionsCacheSeconds,
      pullRequestCacheSeconds,
      rateLimitCooldownSeconds,
      embeddedSupervisorEnabled,
      embeddedSupervisorHost,
      embeddedSupervisorPort,
      embeddedSupervisorApiToken,
      codexCliPath,
      copilotCliPath,
      claudeCliPath,
      geminiCliPath,
      cliBootstrapOnStartup,
      cliStartupSpawnPtyTerminals,
      cliStartupAutoInstallMissing,
      cliStartupAutoSignIn,
      codexCliInstallCommand,
      copilotCliInstallCommand,
      claudeCliInstallCommand,
      geminiCliInstallCommand,
      codexDefaultModel,
      copilotDefaultModel,
      copilotCloudEnabled,
      codexModelOptions,
      copilotModelOptions,
      agentModelCatalogUrl,
      agentModelCatalogAuthToken,
      jarvisEnabled,
      jarvisAutoAnnouncements,
      jarvisApiBaseUrl,
      jarvisApiKey,
      jarvisTextModel,
      jarvisSpeechModel,
      jarvisVoice,
      jarvisTtsProvider,
      jarvisGeminiApiKey,
      jarvisGeminiModel,
      jarvisGeminiVoice,
      jarvisTtsDebug,
      jarvisMaxAnnouncementsPerHour,
      jarvisMinSecondsBetweenAnnouncements,
      jarvisReasonCooldownMinutes,
      jarvisPollinationsHardCooldownSeconds,
      jarvisPollinationsSoftCooldownSeconds,
      jarvisHostPlaybackSpacingMs,
      jarvisOfferJokes,
      jarvisConversationHistoryTurns
    };
  }

  async checkGhAuth(): Promise<{ ok: boolean; output: string }> {
    return await this.gh.authStatus();
  }

  async ensureGhAuth(scopes: string[]): Promise<void> {
    const status = await this.gh.authStatus();
    if (status.ok) {
      try {
        await this.gh.authRefreshScopes(scopes);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (!message.includes("not logged in")) {
          // Fall through to login in case refresh is unsupported in the current gh version.
        }
      }
    }

    try {
      await this.gh.authLoginWithOauth(scopes);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (status.ok && message.includes("already logged in")) {
        return;
      }
      throw error;
    }
  }

  async fetchLocalSnapshot(
    sequence: number,
    streamConnected: boolean,
    stale: boolean,
    reason: RefreshReason
  ): Promise<DashboardSnapshot> {
    this.loadCacheFromDiskIfNeeded();
    const settings = this.getSettings();
    const ghAllowed = Date.now() >= this.ghCooldownUntilMs;

    const board = await this.getBoardSnapshot(settings, reason, ghAllowed);
    const actions = await this.getActionsSnapshot(settings, reason, ghAllowed);
    const pullRequests = await this.getPullRequestsSnapshot(settings, reason, ghAllowed);
    const staleSnapshot = stale || board.degraded || actions.degraded || pullRequests.degraded;

    return {
      board: { items: board.items },
      actions: { runs: actions.runs, jobs: actions.jobs, pullRequests: pullRequests.pullRequests },
      agents: { sessions: [], feed: [], pendingCommands: [] },
      meta: {
        generatedAt: new Date().toISOString(),
        sequence,
        source: "local-gh",
        streamConnected,
        stale: staleSnapshot
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

  async getRepositoryLabels(repo: string): Promise<string[]> {
    return await this.gh.getRepositoryLabels(repo);
  }

  async createIssue(repo: string, title: string, body: string, labels: string[]): Promise<{ url: string | null; number: number | null }> {
    return await this.gh.createIssue(repo, title, body, labels);
  }

  async createPullRequest(params: {
    repo: string;
    title: string;
    body: string;
    base: string;
    head: string;
    draft: boolean;
  }): Promise<void> {
    await this.gh.createPullRequest(params);
  }

  async updatePullRequest(params: {
    repo: string;
    number: number;
    title?: string;
    body?: string;
    readyForReview?: boolean;
  }): Promise<void> {
    await this.gh.updatePullRequest(params);
  }

  async mergePullRequest(params: {
    repo: string;
    number: number;
    method: "merge" | "squash" | "rebase";
    deleteBranch: boolean;
    auto: boolean;
  }): Promise<void> {
    await this.gh.mergePullRequest(params);
  }

  async commentPullRequest(repo: string, number: number, body: string): Promise<void> {
    await this.gh.commentPullRequest(repo, number, body);
  }

  async updateLabels(item: BoardItem, addLabels: string[], removeLabels: string[]): Promise<void> {
    if (!item.issueNumber) {
      throw new Error("Cannot update labels: selected board item has no issue number.");
    }

    const repo = repoUrlToSlug(item.repo);
    await this.gh.updateIssueLabels(repo, item.issueNumber, addLabels, removeLabels);
  }

  async getPullRequestInsights(repo: string, number: number): Promise<PullRequestInsights> {
    const [rawReviews, rawComments] = await Promise.all([
      this.gh.getPullRequestReviews(repo, number),
      this.gh.getPullRequestReviewComments(repo, number)
    ]);

    const normalizeIso = (value: unknown): string | null => {
      if (typeof value !== "string" || value.trim().length === 0) {
        return null;
      }
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
    };

    const normalizeAuthor = (entry: Record<string, unknown>): string => {
      const user = entry.user;
      if (user && typeof user === "object" && typeof (user as { login?: unknown }).login === "string") {
        return ((user as { login: string }).login || "unknown").trim() || "unknown";
      }
      const author = entry.author;
      if (author && typeof author === "object" && typeof (author as { login?: unknown }).login === "string") {
        return ((author as { login: string }).login || "unknown").trim() || "unknown";
      }
      return "unknown";
    };

    const normalizeBody = (value: unknown): string => {
      if (typeof value !== "string") {
        return "";
      }
      return value.trim();
    };

    const isCopilotAuthor = (author: string): boolean => {
      const lowered = author.toLowerCase();
      return lowered.includes("copilot");
    };

    const reviews: PullRequestInsightEntry[] = rawReviews
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
      .map((entry) => {
        const author = normalizeAuthor(entry);
        const body = normalizeBody(entry.body);
        const id = String(entry.id ?? `${repo}#${number}:review:${author}:${entry.submitted_at ?? ""}`);
        const createdAt = normalizeIso(entry.submitted_at ?? entry.created_at);
        const updatedAt = normalizeIso(entry.submitted_at ?? entry.updated_at ?? entry.created_at);
        const state = typeof entry.state === "string" ? entry.state : null;
        const url = typeof entry.html_url === "string" ? entry.html_url : null;
        return {
          id,
          kind: "review" as const,
          author,
          body,
          state,
          createdAt,
          updatedAt,
          url,
          path: null,
          line: null,
          isCopilot: isCopilotAuthor(author)
        };
      })
      .sort((a, b) => (Date.parse(b.updatedAt ?? b.createdAt ?? "") || 0) - (Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0));

    const comments: PullRequestInsightEntry[] = rawComments
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
      .map((entry) => {
        const author = normalizeAuthor(entry);
        const body = normalizeBody(entry.body);
        const id = String(entry.id ?? `${repo}#${number}:comment:${author}:${entry.created_at ?? ""}`);
        const createdAt = normalizeIso(entry.created_at);
        const updatedAt = normalizeIso(entry.updated_at ?? entry.created_at);
        const url = typeof entry.html_url === "string" ? entry.html_url : null;
        const path = typeof entry.path === "string" ? entry.path : null;
        const line = typeof entry.line === "number"
          ? entry.line
          : (typeof entry.original_line === "number" ? entry.original_line : null);
        return {
          id,
          kind: "comment" as const,
          author,
          body,
          state: null,
          createdAt,
          updatedAt,
          url,
          path,
          line,
          isCopilot: isCopilotAuthor(author)
        };
      })
      .sort((a, b) => (Date.parse(b.updatedAt ?? b.createdAt ?? "") || 0) - (Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0));

    return {
      repo,
      number,
      reviews,
      comments,
      fetchedAt: new Date().toISOString()
    };
  }

  async getActionRunLog(repo: string, runId: number): Promise<ActionRunLogResult> {
    const rawText = await this.gh.getRunLog(repo, runId);
    const normalized = rawText.replace(/\r\n/g, "\n").trim();
    const maxCharacters = 80000;
    let text = normalized;
    let truncated = false;
    if (text.length > maxCharacters) {
      truncated = true;
      const omitted = text.length - maxCharacters;
      text = `... log truncated (${omitted} characters omitted) ...\n\n${text.slice(-maxCharacters)}`;
    }
    if (!text) {
      text = "(No log output was returned for this run.)";
    }
    return {
      repo,
      runId,
      text,
      truncated,
      fetchedAt: new Date().toISOString()
    };
  }

  async retryActionRun(repo: string, runId: number, failedOnly: boolean): Promise<void> {
    await this.gh.retryRun(repo, runId, failedOnly);
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

  private async getBoardSnapshot(
    settings: RuntimeSettings,
    reason: RefreshReason,
    ghAllowed: boolean
  ): Promise<{ items: BoardItem[]; fresh: boolean; degraded: boolean }> {
    const key = `${settings.owner}/${settings.projectNumber}`;
    const cached = this.boardCache?.key === key ? this.boardCache : null;

    if (!ghAllowed) {
      if (cached) {
        return { items: cached.items, fresh: false, degraded: true };
      }
      throw new Error("GitHub API cooldown is active and no cached board data is available.");
    }

    const ttlMs = settings.boardCacheSeconds * 1000;
    if (cached && !this.shouldRefresh(cached.fetchedAtMs, ttlMs, reason)) {
      return { items: cached.items, fresh: false, degraded: false };
    }

    try {
      const boardRaw = await this.gh.getProjectItems(settings.owner, settings.projectNumber, 200);
      const items = mapBoardItems(boardRaw.items ?? []);
      this.boardCache = {
        key,
        fetchedAtMs: Date.now(),
        items
      };
      this.persistCacheToDisk();
      return { items, fresh: true, degraded: false };
    } catch (error) {
      this.notePossibleRateLimit(error, settings.rateLimitCooldownSeconds);
      if (cached) {
        return { items: cached.items, fresh: false, degraded: true };
      }
      throw error;
    }
  }

  private async getActionsSnapshot(
    settings: RuntimeSettings,
    reason: RefreshReason,
    ghAllowed: boolean
  ): Promise<{ runs: ActionRun[]; jobs: ActionJob[]; fresh: boolean; degraded: boolean }> {
    const key = settings.repositories.slice().sort().join("|");
    const cached = this.actionsCache?.key === key ? this.actionsCache : null;

    if (!ghAllowed) {
      if (cached) {
        return { runs: cached.runs, jobs: cached.jobs, fresh: false, degraded: true };
      }
      throw new Error("GitHub API cooldown is active and no cached Actions data is available.");
    }

    const ttlMs = settings.actionsCacheSeconds * 1000;
    if (cached && !this.shouldRefresh(cached.fetchedAtMs, ttlMs, reason)) {
      return { runs: cached.runs, jobs: cached.jobs, fresh: false, degraded: false };
    }

    try {
      const { runs, jobs } = await this.fetchRunsAndJobs(settings.repositories);
      this.actionsCache = {
        key,
        fetchedAtMs: Date.now(),
        runs,
        jobs
      };
      this.persistCacheToDisk();
      return { runs, jobs, fresh: true, degraded: false };
    } catch (error) {
      this.notePossibleRateLimit(error, settings.rateLimitCooldownSeconds);
      if (cached) {
        return { runs: cached.runs, jobs: cached.jobs, fresh: false, degraded: true };
      }
      throw error;
    }
  }

  private async getPullRequestsSnapshot(
    settings: RuntimeSettings,
    reason: RefreshReason,
    ghAllowed: boolean
  ): Promise<{ pullRequests: PullRequestSummary[]; fresh: boolean; degraded: boolean }> {
    const key = settings.repositories.slice().sort().join("|");
    const cached = this.pullRequestCache?.key === key ? this.pullRequestCache : null;

    if (!ghAllowed) {
      if (cached) {
        return { pullRequests: cached.pullRequests, fresh: false, degraded: true };
      }
      throw new Error("GitHub API cooldown is active and no cached pull request data is available.");
    }

    const ttlMs = settings.pullRequestCacheSeconds * 1000;
    if (cached && !this.shouldRefresh(cached.fetchedAtMs, ttlMs, reason)) {
      return { pullRequests: cached.pullRequests, fresh: false, degraded: false };
    }

    try {
      const pullRequests = await this.fetchPullRequests(settings.repositories);
      this.pullRequestCache = {
        key,
        fetchedAtMs: Date.now(),
        pullRequests
      };
      this.persistCacheToDisk();
      return { pullRequests, fresh: true, degraded: false };
    } catch (error) {
      this.notePossibleRateLimit(error, settings.rateLimitCooldownSeconds);
      if (cached) {
        return { pullRequests: cached.pullRequests, fresh: false, degraded: true };
      }
      throw error;
    }
  }

  private shouldRefresh(fetchedAtMs: number, ttlMs: number, reason: RefreshReason): boolean {
    const ageMs = Date.now() - fetchedAtMs;
    if (reason === "write") {
      return true;
    }
    if (reason === "startup") {
      return ageMs >= ttlMs;
    }
    if (reason === "manual") {
      return ageMs >= Math.min(ttlMs, 60000);
    }
    return ageMs >= ttlMs;
  }

  private notePossibleRateLimit(error: unknown, cooldownSeconds: number): void {
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    if (
      lowered.includes("api rate limit exceeded") ||
      lowered.includes("secondary rate limit") ||
      lowered.includes("rate limit")
    ) {
      const until = Date.now() + cooldownSeconds * 1000;
      this.ghCooldownUntilMs = Math.max(this.ghCooldownUntilMs, until);
      return;
    }

    if (lowered.includes("unknown owner type") || lowered.includes("could not resolve to a node")) {
      const until = Date.now() + Math.min(120, cooldownSeconds) * 1000;
      this.ghCooldownUntilMs = Math.max(this.ghCooldownUntilMs, until);
    }
  }

  private async fetchRunsAndJobs(repositories: string[]): Promise<{ runs: ActionRun[]; jobs: ActionJob[] }> {
    const runLists = await Promise.allSettled(repositories.map((repo) => this.gh.getRunList(repo, 25)));
    const runs: ActionRun[] = [];
    let runListSuccessCount = 0;
    let firstRunListError: unknown = null;

    runLists.forEach((result, index) => {
      if (result.status !== "fulfilled") {
        if (!firstRunListError) {
          firstRunListError = result.reason;
        }
        return;
      }
      runListSuccessCount += 1;

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

    if (repositories.length > 0 && runListSuccessCount === 0) {
      if (firstRunListError instanceof Error) {
        throw firstRunListError;
      }
      throw new Error("Unable to load workflow runs from any configured repository.");
    }

    const nowMs = Date.now();
    const minTimestampMs = nowMs - ACTIONS_LOOKBACK_WINDOW_MS;
    const runTimestampMs = (run: ActionRun): number => {
      const updatedAtMs = Date.parse(run.updatedAt);
      if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) {
        return updatedAtMs;
      }
      const createdAtMs = Date.parse(run.createdAt);
      return Number.isFinite(createdAtMs) ? createdAtMs : 0;
    };
    const recentRuns = runs
      .filter((run) => {
        const atMs = runTimestampMs(run);
        return atMs >= minTimestampMs && atMs <= nowMs;
      })
      .sort((left, right) => runTimestampMs(right) - runTimestampMs(left));

    const inspectRuns = recentRuns
      .filter((run) => run.status === "queued" || run.status === "in_progress" || isNeedsAttention(run.conclusion))
      .slice(0, 20);

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

    return { runs: recentRuns, jobs };
  }

  private async fetchPullRequests(repositories: string[]): Promise<PullRequestSummary[]> {
    const lists = await Promise.allSettled(repositories.map((repo) => this.gh.getPullRequests(repo, 50)));
    const pullRequests: PullRequestSummary[] = [];
    let successCount = 0;
    let firstError: unknown = null;

    lists.forEach((result, index) => {
      if (result.status !== "fulfilled") {
        if (!firstError) {
          firstError = result.reason;
        }
        return;
      }
      successCount += 1;

      const repo = repositories[index];
      const list = Array.isArray(result.value) ? result.value : [];
      for (const entry of list) {
        if (!entry || typeof entry !== "object") {
          continue;
        }

        const raw = entry as Record<string, unknown>;
        const number = Number(raw.number ?? 0);
        const title = typeof raw.title === "string" ? raw.title : "";
        const url = typeof raw.url === "string" ? raw.url : "";
        if (!number || !title || !url) {
          continue;
        }

        const reviewDecision = typeof raw.reviewDecision === "string" ? raw.reviewDecision.toUpperCase() : "";
        const isDraft = Boolean(raw.isDraft);
        let reviewState: PullRequestSummary["reviewState"] = "unknown";
        if (isDraft) {
          reviewState = "draft";
        } else if (reviewDecision === "CHANGES_REQUESTED") {
          reviewState = "changes_requested";
        } else if (reviewDecision === "APPROVED") {
          reviewState = "approved";
        } else if (reviewDecision === "REVIEW_REQUIRED" || reviewDecision === "") {
          reviewState = "review_required";
        }

        const author = raw.author && typeof raw.author === "object"
          ? ((raw.author as { login?: unknown }).login as string | undefined) ?? null
          : null;

        pullRequests.push({
          id: `${repo}#${number}`,
          repo,
          number,
          title,
          state: typeof raw.state === "string" ? raw.state : "OPEN",
          reviewState,
          isDraft,
          headBranch: typeof raw.headRefName === "string" ? raw.headRefName : null,
          baseBranch: typeof raw.baseRefName === "string" ? raw.baseRefName : null,
          author: typeof author === "string" ? author : null,
          updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
          createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
          url
        });
      }
    });

    if (repositories.length > 0 && successCount === 0) {
      if (firstError instanceof Error) {
        throw firstError;
      }
      throw new Error("Unable to load pull requests from any configured repository.");
    }

    return pullRequests.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  }

  private loadCacheFromDiskIfNeeded(): void {
    if (this.diskCacheLoaded) {
      return;
    }
    this.diskCacheLoaded = true;

    if (!this.cacheFilePath || !fs.existsSync(this.cacheFilePath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.cacheFilePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedCacheFile;
      if (parsed?.version !== 1) {
        return;
      }

      if (parsed.boardCache && typeof parsed.boardCache.key === "string") {
        this.boardCache = parsed.boardCache;
      }

      if (parsed.actionsCache && typeof parsed.actionsCache.key === "string") {
        this.actionsCache = parsed.actionsCache;
      }

      if (parsed.pullRequestCache && typeof parsed.pullRequestCache.key === "string") {
        this.pullRequestCache = parsed.pullRequestCache;
      }
    } catch {
      // Ignore cache read/parse errors and continue with live fetch path.
    }
  }

  private persistCacheToDisk(): void {
    if (!this.cacheFilePath) {
      return;
    }

    const payload: PersistedCacheFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      boardCache: this.boardCache ?? undefined,
      actionsCache: this.actionsCache ?? undefined,
      pullRequestCache: this.pullRequestCache ?? undefined
    };

    try {
      fs.mkdirSync(path.dirname(this.cacheFilePath), { recursive: true });
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(payload), "utf8");
    } catch {
      // Ignore cache write errors; they should not block extension behavior.
    }
  }
}
