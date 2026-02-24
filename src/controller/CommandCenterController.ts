import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import * as vscode from "vscode";
import type {
  ActionRunLogRequestPayload,
  AgentCommandDecisionPayload,
  AgentDispatchPayload,
  AgentMessagePayload,
  AgentTerminalInputPayload,
  AgentTerminalStreamPayload,
  AgentStopPayload,
  CommentPullRequestFromViewPayload,
  CreateIssueFromViewPayload,
  CreatePullRequestFromViewPayload,
  IssueActionPayload,
  IssueCreateMetadataRequestPayload,
  JarvisFocusHint,
  JarvisSpeakPayload,
  JarvisStatePayload,
  SupervisorJarvisRespondPayload,
  PullRequestInsightsRequestPayload,
  PullRequestOpenPayload,
  RetryActionRunPayload
} from "./CommandCenterPayloads";
import type { PendingBoardUiAction } from "./issuePullRequestHandlers";
import {
  commentPullRequestFromView as commentPullRequestFromViewHandler,
  createIssueFromView as createIssueFromViewHandler,
  createPullRequestFromView as createPullRequestFromViewHandler,
  issueCreateMetadataRequest as issueCreateMetadataRequestHandler,
  openCommandCenterForTabAction as openCommandCenterForTabActionHandler,
  postRuntimeContext as postRuntimeContextHandler
} from "./issuePullRequestHandlers";
import {
  findBoardItemById,
  pickBoardItem,
  pickPullRequest,
  pickRun
} from "./snapshotPickers";
import { routeWebviewMessage } from "./webviewMessageRouter";
import {
  addActiveFileContext as addActiveFileContextHandler,
  addSelectionContext as addSelectionContextHandler,
  addWorkspaceFileContext as addWorkspaceFileContextHandler,
  dispatchAgent as dispatchAgentHandler,
  openPullRequestByNumber as openPullRequestByNumberHandler,
  openSessionInEditor as openSessionInEditorHandler,
  postSupervisorJson as postSupervisorJsonHandler,
  resolveCurrentWorkspaceContext as resolveCurrentWorkspaceContextHandler,
  resolvePendingCommand as resolvePendingCommandHandler,
  sendAgentMessage as sendAgentMessageHandler,
  stopAgent as stopAgentHandler,
  defaultWorkspacePath
} from "./agentRuntimeHandlers";
import {
  invalidateAgentModelCatalogCache as invalidateAgentModelCatalogCacheHandler,
  resolveAgentModelCatalog as resolveAgentModelCatalogHandler
} from "./agentModelCatalogHandlers";
import {
  ensureEmbeddedSupervisorStarted as ensureEmbeddedSupervisorStartedHandler,
  syncEmbeddedSupervisorNow as syncEmbeddedSupervisorNowHandler
} from "./embeddedSupervisorHandlers";
import {
  pickAgentModelHubConfig,
  pickSupervisorModeConfig
} from "./configurationPrompts";
import {
  activateJarvis as activateJarvisHandler,
  tickJarvisAuto as tickJarvisAutoHandler
} from "./jarvisInteractionHandlers";
import { tryJarvisDelegatedApproval as tryJarvisDelegatedApprovalHandler } from "./jarvisDelegatedApprovalHandler";
import {
  forwardJarvisSpeakToSupervisor as forwardJarvisSpeakToSupervisorHandler,
  requestJarvisRespondFromSupervisor as requestJarvisRespondFromSupervisorHandler
} from "./jarvisSupervisorHandlers";
import {
  type CodexDeviceAuthPrompt,
  createUnknownCliAuthStatus,
  probeCliAuthStatus,
  type CliAuthService,
  type CliAuthStatus,
  resolveConfigTargetForKey,
  runCodexDeviceAuthSignIn,
  runAuthCommandFromSetting,
  updatePhoenixSettings
} from "./settingsAuthHandlers";
import {
  refreshFromSupervisor as refreshFromSupervisorHandler,
  startDataFlow as startDataFlowHandler,
  tryStartSupervisorStream as tryStartSupervisorStreamHandler
} from "./supervisorFlowHandlers";
import { CommandCenterViewProvider } from "../providers/CommandCenterViewProvider";
import { DataService, RefreshReason } from "../services/DataService";
import { EmbeddedSupervisorManager } from "../services/EmbeddedSupervisorManager";
import { GhClient } from "../services/GhClient";
import { JarvisConversationTurn, JarvisService, JarvisSpeechResult } from "../services/JarvisService";
import { JarvisHostAudioPlayer } from "../services/JarvisHostAudioPlayer";
import { WorkspaceSupervisorManager } from "../services/WorkspaceSupervisorManager";
import {
  PollinationsCooldownTracker,
  PollinationsFailureKind,
  normalizePollinationsFailure
} from "../services/PollinationsResilience";
import { SupervisorStreamClient } from "../services/SupervisorStreamClient";
import { SupervisorTerminalClient } from "../services/SupervisorTerminalClient";
import {
  ActionRun,
  BoardItem,
  DashboardSnapshot,
  PullRequestSummary,
  ProjectFieldName,
  StreamEnvelope
} from "../types";
import type { AgentModelCatalogPayload } from "../utils/agentModelCatalog";
import {
  buildJarvisSessionSnapshot,
  buildJarvisSessionSummary,
  buildJarvisStartupGreeting,
  createJarvisSessionId,
  createJarvisSessionMemoryStore,
  listRecentStartupAgentSessionSummaries,
  persistJarvisSessionMemory,
  upsertJarvisSessionMemory,
  type JarvisSessionMemoryStore
} from "../utils/jarvisSessionMemory";
import { buildJarvisTtsInstructions } from "../utils/jarvisPrompts";
import type { JarvisIdentity, JarvisPersonalityMode } from "../utils/jarvisPrompts";
import { readJarvisIdentityFromDisk, writeJarvisIdentityToDisk } from "../utils/jarvisIdentity";
import { parseCliInvocation } from "../utils/cliCommand";
import { applyStreamEnvelope } from "../utils/transform";

const PROJECT_FIELD_NAMES: ProjectFieldName[] = ["Status", "Work mode", "Priority", "Size", "Area"];
const REQUIRED_GH_SCOPES = ["repo", "project", "workflow", "admin:repo_hook"];
const PINNED_SESSION_STORAGE_KEY = "phoenixOps.pinnedSessions";
const ARCHIVED_SESSION_STORAGE_KEY = "phoenixOps.archivedSessions";
const JARVIS_MANUAL_MODE_STORAGE_KEY = "phoenixOps.jarvisManualMode";
const JARVIS_AUTO_LOOP_MS = 30_000;
const ACTIONS_LOOKBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
const JARVIS_AUDITION_PERSONALITIES: JarvisPersonalityMode[] = ["serene", "attentive", "alert", "escalating"];
const JARVIS_SESSION_MEMORY_FILENAME = "phoenix-jarvis-session-memory.json";
const JARVIS_SESSION_MEMORY_MAX_SESSIONS = 36;
const JARVIS_SESSION_MEMORY_MAX_TURNS = 64;
const JARVIS_STARTUP_PRIOR_SUMMARY_COUNT = 3;
type StartupTerminalService = CliAuthService | "claude" | "gemini";
const STARTUP_TERMINAL_SERVICES: readonly StartupTerminalService[] = ["codex", "copilot", "claude", "gemini"];
const AUTH_TRACKED_STARTUP_SERVICES: readonly CliAuthService[] = ["codex", "copilot"];
const STARTUP_INIT_BLOCKING_BUDGET_MS = 1500;
const STARTUP_CLI_BOOTSTRAP_DEFER_MS = 2500;
const STARTUP_INSTALL_ATTEMPT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const STARTUP_SIGNIN_ATTEMPT_COOLDOWN_MS = 30 * 60 * 1000;

export class CommandCenterController implements vscode.Disposable {
  private readonly boardViewProvider: CommandCenterViewProvider;
  private readonly agentViewProvider: CommandCenterViewProvider;
  private readonly dataService: DataService;
  private readonly workspaceSupervisorManager: WorkspaceSupervisorManager;
  private readonly embeddedSupervisorManager: EmbeddedSupervisorManager;
  private readonly jarvisService: JarvisService;
  private readonly streamClient: SupervisorStreamClient;
  private readonly jarvisHostAudioPlayer: JarvisHostAudioPlayer;
  private readonly context: vscode.ExtensionContext;
  private readonly output: vscode.OutputChannel;

  private snapshot: DashboardSnapshot | null = null;
  private sequence = 0;
  private pollingTimer: NodeJS.Timeout | null = null;
  private staleTimer: NodeJS.Timeout | null = null;
  private lastUpdatedMs = 0;
  private streamConnected = false;
  private ghAuthOk = false;
  private cliAuthState: Record<CliAuthService, CliAuthStatus> = {
    codex: createUnknownCliAuthStatus("codex"),
    copilot: createUnknownCliAuthStatus("copilot")
  };
  private readonly cliAuthWatchTimers = new Map<CliAuthService, NodeJS.Timeout>();
  private disposed = false;
  private jarvisManualMode = false;
  private jarvisAutoTimer: NodeJS.Timeout | null = null;
  private readonly jarvisAnnouncementMsHistory: number[] = [];
  private jarvisLastAnnouncementMs = 0;
  private readonly jarvisReasonCooldownMs = new Map<string, number>();
  private jarvisLastMessage: string | null = null;
  private jarvisLastReason: string | null = null;
  private readonly jarvisConversation: JarvisConversationTurn[] = [];
  private readonly jarvisPollinationsCooldown = new PollinationsCooldownTracker();
  private embeddedSupervisorBaseUrl: string | null = null;
  private embeddedSupervisorToken = "";
  private embeddedSupervisorSyncTimer: NodeJS.Timeout | null = null;
  private cachedAgentModelCatalog: AgentModelCatalogPayload | null = null;
  private cachedAgentModelCatalogExpiresAtMs = 0;
  private agentModelCatalogWarnedUntilMs = 0;
  private jarvisIdentity: JarvisIdentity | null = null;
  private readonly vscodeSessionStartedAtMs = Date.now();
  private readonly vscodeSessionStartedAtIso = new Date(this.vscodeSessionStartedAtMs).toISOString();
  private readonly jarvisSessionId = createJarvisSessionId(this.vscodeSessionStartedAtMs);
  private readonly jarvisSessionMemoryFilePath: string;
  private jarvisSessionMemory: JarvisSessionMemoryStore = createJarvisSessionMemoryStore();
  private pinnedSessionIds = new Set<string>();
  private archivedSessionIds = new Set<string>();
  private readonly sessionPanels = new Map<string, vscode.WebviewPanel>();
  private readonly terminalClients = new Map<string, SupervisorTerminalClient>();
  private pendingBoardUiAction: PendingBoardUiAction | null = null;
  private startupCliBootstrapInFlight = false;
  private startupCliBootstrapDone = false;
  private startupCliBootstrapTimer: NodeJS.Timeout | null = null;
  private lastPostedAuthPayload = "";

  constructor(
    boardViewProvider: CommandCenterViewProvider,
    agentViewProvider: CommandCenterViewProvider,
    dataService: DataService,
    context: vscode.ExtensionContext
  ) {
    this.boardViewProvider = boardViewProvider;
    this.agentViewProvider = agentViewProvider;
    this.dataService = dataService;
    this.workspaceSupervisorManager = new WorkspaceSupervisorManager();
    this.embeddedSupervisorManager = new EmbeddedSupervisorManager(context);
    this.jarvisService = new JarvisService();
    this.streamClient = new SupervisorStreamClient();
    this.context = context;
    this.jarvisSessionMemoryFilePath = path.join(this.context.globalStorageUri.fsPath, JARVIS_SESSION_MEMORY_FILENAME);
    this.jarvisSessionMemory = createJarvisSessionMemoryStore();
    this.output = vscode.window.createOutputChannel("Phoenix Ops Command Center");
    this.jarvisHostAudioPlayer = new JarvisHostAudioPlayer({
      info: (message: string) => this.logInfo(message),
      warn: (message: string) => this.logWarn(message)
    });
  }

  async initialize(): Promise<void> {
    this.logInfo("Initializing Phoenix Ops Command Center.");
    this.loadSessionPreferences();
    this.jarvisManualMode = this.context.globalState.get<boolean>(JARVIS_MANUAL_MODE_STORAGE_KEY, false);
    const workspaceSupervisorStartTask = this.ensureWorkspaceSupervisorStarted();
    const embeddedSupervisorStartTask = this.ensureEmbeddedSupervisorStarted();
    const authTask = this.dataService.checkGhAuth();

    await Promise.race([
      Promise.all([workspaceSupervisorStartTask, embeddedSupervisorStartTask]),
      this.sleep(STARTUP_INIT_BLOCKING_BUDGET_MS)
    ]);

    const auth = await authTask;
    this.ghAuthOk = auth.ok;
    void this.refreshCliAuthStatus(["codex", "copilot"]).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logWarn(`startup cli auth refresh failed: ${message}`);
    });
    await this.postAuthState();
    if (!auth.ok) {
      const signInChoice = await vscode.window.showWarningMessage(
        "Phoenix Command Center requires GitHub authentication for board/actions access.",
        "Sign In"
      );
      if (signInChoice === "Sign In") {
        await this.signInCommand();
      }
    }

    this.boardViewProvider.onMessage(async ({ message, webview }) => {
      await this.handleIncomingMessage(message, webview);
    });

    this.agentViewProvider.onMessage(async ({ message, webview }) => {
      await this.handleIncomingMessage(message, webview);
    });

    await this.refreshNow("startup");
    await this.startDataFlow();
    if (this.embeddedSupervisorBaseUrl && this.getRuntimeSettings().useSupervisorStream) {
      await this.syncEmbeddedSupervisorNow("startup");
      this.startEmbeddedSupervisorSyncLoop();
    }
    this.startStaleMonitor();
    this.startJarvisAutoLoop();

    void Promise.allSettled([workspaceSupervisorStartTask, embeddedSupervisorStartTask]).then(() => {
      if (this.disposed) {
        return;
      }
      const runtimeSettings = this.getRuntimeSettings();
      if (this.embeddedSupervisorBaseUrl && runtimeSettings.useSupervisorStream) {
        void this.syncEmbeddedSupervisorNow("startup");
        this.startEmbeddedSupervisorSyncLoop();
      }
      void this.tryStartSupervisorStream();
      void this.refreshNow("manual");
    });

    const startupSettings = this.getRuntimeSettings();
    if (startupSettings.openAgentWorkspaceOnStartup) {
      void this.openAgentWorkspacePanel().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logWarn(`openAgentWorkspaceOnStartup failed: ${message}`);
      });
    }
    if (startupSettings.jarvisStartupGreetingOnStartup) {
      void (async () => {
        await this.loadJarvisIdentity(false);
        await this.sendJarvisStartupGreeting();
      })().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logWarn(`jarvisStartupGreetingOnStartup failed: ${message}`);
      });
    }
    this.scheduleStartupCliBootstrap();
    this.logInfo("Initialization complete.");
  }

  async refreshCommand(): Promise<void> {
    await this.refreshNow("manual");
  }

  async signInCommand(): Promise<void> {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Phoenix Ops: Signing in to GitHub via gh OAuth..."
        },
        async () => {
          await this.dataService.ensureGhAuth(REQUIRED_GH_SCOPES);
        }
      );

      const auth = await this.dataService.checkGhAuth();
      this.ghAuthOk = auth.ok;
      await this.postAuthState();

      if (!auth.ok) {
        vscode.window.showErrorMessage(`GitHub sign-in did not complete. ${auth.output}`);
        return;
      }

      vscode.window.showInformationMessage("GitHub sign-in complete. Refreshing data...");
      await this.refreshNow("manual");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`GitHub sign-in failed: ${message}`);
    }
  }

  async signInCodexCliCommand(): Promise<void> {
    const settings = this.getRuntimeSettings();
    this.logInfo(`[auth:codex] sign-in requested cliPath=${settings.codexCliPath}`);
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Phoenix Ops: Codex web sign-in",
          cancellable: false
        },
        async (progress) => {
          progress.report({ message: "Starting device authorization..." });

          const onPromptDiscovered = async (prompt: CodexDeviceAuthPrompt): Promise<void> => {
            progress.report({ message: "Browser authorization requested. Finish sign-in in your browser..." });
            await vscode.env.openExternal(vscode.Uri.parse(prompt.verificationUrl));
            const copyChoice = await vscode.window.showInformationMessage(
              `Codex one-time code: ${prompt.userCode}`,
              "Copy Code"
            );
            if (copyChoice === "Copy Code") {
              await vscode.env.clipboard.writeText(prompt.userCode);
              void vscode.window.showInformationMessage("Codex device code copied to clipboard.");
            }
          };

          const result = await runCodexDeviceAuthSignIn(settings.codexCliPath, onPromptDiscovered, (line) => {
            this.logInfo(`[auth:codex] ${line}`);
          });
          if (!result.ok) {
            throw new Error(result.output || "Codex sign-in did not complete.");
          }
        }
      );
      this.logInfo("[auth:codex] sign-in flow finished successfully.");
      void vscode.window.showInformationMessage("Codex sign-in complete.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logWarn(`[auth:codex] sign-in flow failed: ${message}`);
      vscode.window.showErrorMessage(`Codex sign-in failed: ${message}`);
    }

    await this.watchCliAuthAfterSignIn("codex");
  }

  async signInCopilotCliCommand(): Promise<void> {
    this.logInfo("[auth:copilot] sign-in requested.");
    const execution = await runAuthCommandFromSetting(
      "copilotCliAuthCommand",
      ["copilot login", "gh auth login --web"],
      "Copilot CLI"
    );
    if (execution) {
      this.logInfo(
        `[auth:copilot] launched terminal='${execution.terminalName}' command='${execution.command}'`
      );
    } else {
      this.logWarn("[auth:copilot] sign-in command did not launch.");
    }
    await this.watchCliAuthAfterSignIn("copilot");
  }

  async geminiSignInCommand(): Promise<void> {
    await this.openUrl("https://aistudio.google.com/app/apikey");
  }

  async geminiSetApiKeyCommand(): Promise<void> {
    const config = vscode.workspace.getConfiguration("phoenixOps");
    const current = config.get<string>("jarvisGeminiApiKey", "");
    const entered = await vscode.window.showInputBox({
      title: "Gemini API Key",
      prompt: "Paste your Gemini API key. Leave blank and confirm to clear it.",
      value: current,
      password: true,
      ignoreFocusOut: true
    });
    if (entered === undefined) {
      return;
    }

    const trimmed = entered.trim();
    if (!trimmed) {
      const clearChoice = await vscode.window.showWarningMessage(
        "Clear the saved Gemini API key?",
        { modal: true },
        "Clear"
      );
      if (clearChoice !== "Clear") {
        return;
      }
    }

    const target = resolveConfigTargetForKey("jarvisGeminiApiKey");
    await config.update("jarvisGeminiApiKey", trimmed, target);
    await this.postJarvisState();
    await this.postRuntimeContext();
    vscode.window.showInformationMessage(trimmed ? "Gemini API key updated." : "Gemini API key cleared.");
  }

  async pollinationsSignInCommand(): Promise<void> {
    await this.openUrl("https://auth.pollinations.ai/");
  }

  async pollinationsSetApiKeyCommand(): Promise<void> {
    const config = vscode.workspace.getConfiguration("phoenixOps");
    const current = config.get<string>("jarvisApiKey", "");
    const entered = await vscode.window.showInputBox({
      title: "Pollinations API Key",
      prompt: "Paste your Pollinations API key. Leave blank and confirm to clear it.",
      value: current,
      password: true,
      ignoreFocusOut: true
    });
    if (entered === undefined) {
      return;
    }

    const trimmed = entered.trim();
    if (!trimmed) {
      const clearChoice = await vscode.window.showWarningMessage(
        "Clear the saved Pollinations API key?",
        { modal: true },
        "Clear"
      );
      if (clearChoice !== "Clear") {
        return;
      }
    }

    const target = resolveConfigTargetForKey("jarvisApiKey");
    await config.update("jarvisApiKey", trimmed, target);
    vscode.window.showInformationMessage(trimmed ? "Pollinations API key updated." : "Pollinations API key cleared.");
  }

  async configureSupervisorModeCommand(): Promise<void> {
    const selected = await pickSupervisorModeConfig(this.dataService.getSettings());
    if (!selected) {
      return;
    }

    await updatePhoenixSettings(selected.updates);
    this.invalidateAgentModelCatalogCache();
    await this.restartSupervisorDataFlow();
    vscode.window.showInformationMessage(`Supervisor mode updated: ${selected.label}.`);
  }

  async configureJarvisVoiceCommand(): Promise<void> {
    const settings = this.dataService.getSettings();
    const providerChoice = await vscode.window.showQuickPick(
      [
        {
          label: "Gemini",
          description: "Gemini TTS only (recommended default)",
          value: "gemini" as const
        },
        {
          label: "Gemini + Pollinations Fallback",
          description: "Try Gemini first and fall back to Pollinations on failure",
          value: "gemini-with-fallback" as const
        },
        {
          label: "Pollinations",
          description: "Use Pollinations speech only",
          value: "pollinations" as const
        }
      ],
      {
        title: "Jarvis TTS Provider",
        placeHolder: "Select the speech provider strategy"
      }
    );
    if (!providerChoice) {
      return;
    }

    const enteredGeminiModel = await vscode.window.showInputBox({
      title: "Gemini TTS Model",
      prompt: "Gemini TTS model ID (for example: gemini-2.5-flash-preview-tts).",
      value: settings.jarvisGeminiModel,
      ignoreFocusOut: true
    });
    if (enteredGeminiModel === undefined) {
      return;
    }

    const enteredGeminiVoice = await vscode.window.showInputBox({
      title: "Gemini Voice",
      prompt: "Gemini prebuilt voice name (for example: Charon).",
      value: settings.jarvisGeminiVoice,
      ignoreFocusOut: true
    });
    if (enteredGeminiVoice === undefined) {
      return;
    }

    const enteredSpeechModel = await vscode.window.showInputBox({
      title: "Jarvis Speech Model",
      prompt: "Model ID for Pollinations /v1/audio/speech (used for Pollinations mode/fallback). Leave empty to auto-select.",
      value: settings.jarvisSpeechModel,
      ignoreFocusOut: true
    });
    if (enteredSpeechModel === undefined) {
      return;
    }
    const enteredVoice = await vscode.window.showInputBox({
      title: "Jarvis Voice ID",
      prompt: "Voice ID sent to Pollinations speech API (for example: onyx, brian, etc.).",
      value: settings.jarvisVoice,
      ignoreFocusOut: true
    });
    if (enteredVoice === undefined) {
      return;
    }

    const debugChoice = await vscode.window.showQuickPick(
      [
        { label: "Off", description: "No extra TTS diagnostics", value: false },
        { label: "On", description: "Verbose Gemini/fallback diagnostics", value: true }
      ],
      {
        title: "Jarvis TTS Debug Logging",
        placeHolder: "Choose whether to log detailed Jarvis TTS provider diagnostics"
      }
    );
    if (!debugChoice) {
      return;
    }

    const speechModel = enteredSpeechModel.trim();
    const voice = enteredVoice.trim();
    const geminiModel = enteredGeminiModel.trim();
    const geminiVoice = enteredGeminiVoice.trim();
    await updatePhoenixSettings([
      ["jarvisTtsProvider", providerChoice.value],
      ["jarvisGeminiModel", geminiModel || "gemini-2.5-flash-preview-tts"],
      ["jarvisGeminiVoice", geminiVoice || "Charon"],
      ["jarvisSpeechModel", speechModel],
      ["jarvisVoice", voice || "onyx"],
      ["jarvisTtsDebug", debugChoice.value]
    ]);
    this.invalidateAgentModelCatalogCache();
    await this.postJarvisState();
    await this.postRuntimeContext();
    const geminiApiKey = vscode.workspace.getConfiguration("phoenixOps").get<string>("jarvisGeminiApiKey", "").trim();
    if (providerChoice.value !== "pollinations" && !geminiApiKey) {
      const action = await vscode.window.showWarningMessage(
        "Jarvis TTS is set to Gemini, but no Gemini API key is configured.",
        "Set Gemini Key",
        "Open Gemini Key Portal"
      );
      if (action === "Set Gemini Key") {
        await this.geminiSetApiKeyCommand();
      } else if (action === "Open Gemini Key Portal") {
        await this.geminiSignInCommand();
      }
      return;
    }
    vscode.window.showInformationMessage("Jarvis TTS settings updated.");
  }

  async configureAgentModelHubCommand(): Promise<void> {
    const selection = await pickAgentModelHubConfig(this.dataService.getSettings());
    if (!selection) {
      return;
    }

    await updatePhoenixSettings(selection.updates);
    this.invalidateAgentModelCatalogCache();
    await this.postRuntimeContext();
    vscode.window.showInformationMessage(selection.statusMessage);
  }

  async createIssueCommand(): Promise<void> {
    const workspaceContext = await resolveCurrentWorkspaceContextHandler();
    await this.openCommandCenterForTabAction({
      tab: "issues",
      openIssueCreate: true,
      preferredRepo: workspaceContext?.repoSlug ?? null
    });
  }

  private snapshotPickerContext(): {
    getSnapshot: () => DashboardSnapshot | null;
    refresh: () => Promise<void>;
  } {
    return {
      getSnapshot: () => this.snapshot,
      refresh: async () => this.refreshNow("manual")
    };
  }

  private issuePullRequestHandlersDeps() {
    return {
      dataService: this.dataService,
      boardViewProvider: this.boardViewProvider,
      getSnapshot: () => this.snapshot,
      setPendingBoardUiAction: (value: PendingBoardUiAction | null) => {
        this.pendingBoardUiAction = value;
      },
      getRuntimeSettings: () => this.getRuntimeSettings(),
      resolveCurrentWorkspaceContext: async () => resolveCurrentWorkspaceContextHandler(),
      resolveAvailableMcpToolIds: () => this.resolveAvailableMcpToolIds(),
      resolveAgentModelCatalog: async (settings: ReturnType<DataService["getSettings"]>) => this.resolveAgentModelCatalog(settings),
      refreshNow: async (reason: RefreshReason) => this.refreshNow(reason),
      sleep: async (ms: number) => this.sleep(ms),
      postWebviewResponse: async (sourceWebview: vscode.Webview | undefined, type: string, payload: unknown) =>
        this.postWebviewResponse(sourceWebview, type, payload)
    };
  }

  private agentRuntimeHandlersDeps() {
    return {
      dataService: this.dataService,
      getRuntimeSettings: () => this.getRuntimeSettings(),
      getSnapshot: () => this.snapshot,
      refreshNow: async (reason: RefreshReason) => this.refreshNow(reason),
      openSessionPanel: async (sessionId: string) => this.openSessionPanel(sessionId),
      openUrl: async (url: string) => this.openUrl(url),
      postContextResponse: async (
        sourceWebview: vscode.Webview | undefined,
        type: "contextAdded" | "contextError",
        payload: unknown
      ) => this.postContextResponse(sourceWebview, type, payload)
    };
  }

  private jarvisSupervisorHandlersDeps() {
    return {
      getDataSettings: () => this.dataService.getSettings(),
      getRuntimeSettings: () => this.getRuntimeSettings(),
      getSnapshot: () => this.snapshot,
      configuredSupervisorConnection: () => this.configuredSupervisorConnection(),
      isLocalSupervisorBaseUrl: (baseUrl: string) => this.isLocalSupervisorBaseUrl(baseUrl),
      ensureWorkspaceSupervisorStarted: async () => this.ensureWorkspaceSupervisorStarted(),
      waitForSupervisorSnapshotReady: async (baseUrl: string, authToken: string, timeoutMs: number) =>
        this.waitForSupervisorSnapshotReady(baseUrl, authToken, timeoutMs),
      sleep: async (ms: number) => this.sleep(ms),
      postStatus: async (message: string, level: "ok" | "warn" | "err") => this.postStatus(message, level),
      logInfo: (message: string) => this.logInfo(message),
      logWarn: (message: string) => this.logWarn(message),
      emitJarvisPayload: async (payload: JarvisSpeakPayload, forwardToSupervisor: boolean) =>
        this.emitJarvisPayload(payload, forwardToSupervisor),
      clearPollinationsCooldown: (channel: "chat" | "speech") => this.clearPollinationsCooldown(channel),
      rememberJarvisTurn: (role: "user" | "assistant", content: string, maxTurns: number) =>
        this.rememberJarvisTurn(role, content, maxTurns)
    };
  }

  private agentModelCatalogHandlersDeps() {
    return {
      getCachedCatalog: () => this.cachedAgentModelCatalog,
      getCachedCatalogExpiresAtMs: () => this.cachedAgentModelCatalogExpiresAtMs,
      setCachedCatalog: (payload: AgentModelCatalogPayload | null, expiresAtMs: number) => {
        this.cachedAgentModelCatalog = payload;
        this.cachedAgentModelCatalogExpiresAtMs = expiresAtMs;
      },
      getWarnedUntilMs: () => this.agentModelCatalogWarnedUntilMs,
      setWarnedUntilMs: (untilMs: number) => {
        this.agentModelCatalogWarnedUntilMs = untilMs;
      },
      postStatus: async (message: string, level: "ok" | "warn" | "err") => this.postStatus(message, level)
    };
  }

  private jarvisInteractionHandlersDeps() {
    return {
      getSnapshot: () => this.snapshot,
      isDisposed: () => this.disposed,
      getRuntimeSettings: () => this.getRuntimeSettings(),
      isJarvisManualMode: () => this.jarvisManualMode,
      getJarvisLastAnnouncementMs: () => this.jarvisLastAnnouncementMs,
      canAnnounceJarvis: (reason: string, settings: ReturnType<DataService["getSettings"]>) =>
        this.canAnnounceJarvis(reason, settings),
      requestJarvisRespondFromSupervisor: async (input: {
        prompt: string;
        reason: string;
        auto: boolean;
        focusHint: JarvisFocusHint | null;
        rememberPrompt: string | null;
        warnOnFailure: boolean;
      }) => this.requestJarvisRespondFromSupervisor(input),
      getJarvisServiceSettings: (settings: ReturnType<DataService["getSettings"]>) => this.getJarvisServiceSettings(settings),
      getJarvisConversation: () => this.jarvisConversation,
      generateJarvisReply: async (
        systemPrompt: string,
        userPrompt: string,
        conversation: JarvisConversationTurn[],
        settings: { apiBaseUrl: string; apiKey: string; textModel: string; speechModel: string; voice: string }
      ) => this.jarvisService.generateReply(systemPrompt, userPrompt, conversation, settings),
      getPollinationsCooldownSnapshot: (channel: "chat" | "speech") => this.jarvisPollinationsCooldown.snapshot(channel),
      pollinationsCooldownNotice: (channel: "chat" | "speech", failureKind: PollinationsFailureKind | null, untilMs: number) =>
        this.pollinationsCooldownNotice(channel, failureKind, untilMs),
      clearPollinationsCooldown: (channel: "chat" | "speech") => this.clearPollinationsCooldown(channel),
      notePollinationsFailure: (
        channel: "chat" | "speech",
        error: unknown,
        settings: ReturnType<DataService["getSettings"]>
      ) => this.notePollinationsFailure(channel, error, settings),
      rememberJarvisTurn: (role: "user" | "assistant", content: string, historyTurns: number) =>
        this.rememberJarvisTurn(role, content, historyTurns),
      emitJarvisSpeech: async (input: {
        text: string;
        reason: string;
        auto: boolean;
        focusHint: JarvisFocusHint | null;
        personality?: JarvisPersonalityMode;
      }) => this.emitJarvisSpeech(input),
      refreshNow: async (reason: RefreshReason) => this.refreshNow(reason),
      tryJarvisDelegatedApproval: async (prompt: string, snapshot: DashboardSnapshot) =>
        this.tryJarvisDelegatedApproval(prompt, snapshot),
      showWarningMessage: (message: string) => {
        vscode.window.showWarningMessage(message);
      },
      getJarvisIdentity: () => this.jarvisIdentity
    };
  }

  private jarvisDelegatedApprovalDeps() {
    return {
      postSupervisorDecision: async (commandId: string) => {
        await postSupervisorJsonHandler(this.agentRuntimeHandlersDeps(), "/agents/command/decision", {
          commandId,
          approve: true,
          note: "Approved by Jarvis delegation"
        });
      },
      refreshNow: async (reason: RefreshReason) => this.refreshNow(reason)
    };
  }

  private embeddedSupervisorHandlersDeps() {
    return {
      getSettings: () => this.dataService.getSettings(),
      embeddedSupervisorManager: this.embeddedSupervisorManager,
      getEmbeddedSupervisorBaseUrl: () => this.embeddedSupervisorBaseUrl,
      setEmbeddedSupervisorBaseUrl: (value: string | null) => {
        this.embeddedSupervisorBaseUrl = value;
      },
      getEmbeddedSupervisorToken: () => this.embeddedSupervisorToken,
      setEmbeddedSupervisorToken: (value: string) => {
        this.embeddedSupervisorToken = value;
      },
      postStatus: async (message: string, level: "ok" | "warn" | "err") => this.postStatus(message, level),
      nextSequence: () => {
        this.sequence += 1;
        return this.sequence;
      },
      fetchLocalSnapshot: async (
        sequence: number,
        streamConnected: boolean,
        forceRefresh: boolean,
        reason: RefreshReason
      ) => this.dataService.fetchLocalSnapshot(sequence, streamConnected, forceRefresh, reason)
    };
  }

  private supervisorFlowHandlersDeps() {
    return {
      getRuntimeSettings: () => this.getRuntimeSettings(),
      streamClient: this.streamClient,
      fetchSnapshot: async (snapshotUrl: string, authToken: string) => this.fetchSnapshot(snapshotUrl, authToken),
      acceptSnapshot: (snapshot: DashboardSnapshot) => this.acceptSnapshot(snapshot),
      onStreamEnvelope: (envelope: StreamEnvelope) => this.onStreamEnvelope(envelope),
      getStreamConnected: () => this.streamConnected,
      setStreamConnected: (value: boolean) => {
        this.streamConnected = value;
      },
      logInfo: (message: string) => this.logInfo(message),
      logWarn: (message: string) => this.logWarn(message),
      postStatus: async (message: string, level: "ok" | "warn" | "err") => this.postStatus(message, level),
      startPolling: () => this.startPolling(),
      stopPolling: () => this.stopPolling(),
      sleep: async (ms: number) => this.sleep(ms)
    };
  }

  private webviewMessageRouterContext() {
    return {
      getSnapshot: () => this.snapshot,
      postAuthState: async () => this.postAuthState(),
      postJarvisState: async (sourceWebview?: vscode.Webview) => this.postJarvisState(sourceWebview),
      pushSnapshot: async () => this.pushSnapshot(),
      refreshNow: async (reason: RefreshReason) => this.refreshNow(reason),
      postRuntimeContext: async (sourceWebview?: vscode.Webview) => this.postRuntimeContext(sourceWebview),
      getPendingBoardUiAction: () => this.pendingBoardUiAction,
      clearPendingBoardUiAction: () => {
        this.pendingBoardUiAction = null;
      },
      boardViewOwnsWebview: (webview?: vscode.Webview) => this.boardViewProvider.ownsWebview(webview),
      postWebviewResponse: async (sourceWebview: vscode.Webview | undefined, type: string, payload: unknown) =>
        this.postWebviewResponse(sourceWebview, type, payload),
      activateJarvis: async (prompt: string) => this.activateJarvis(prompt),
      jarvisToggleManualModeCommand: async () => this.jarvisToggleManualModeCommand(),
      issueCreateMetadataRequest: async (payload: IssueCreateMetadataRequestPayload, sourceWebview?: vscode.Webview) =>
        this.issueCreateMetadataRequest(payload, sourceWebview),
      createIssueFromView: async (payload: CreateIssueFromViewPayload, sourceWebview?: vscode.Webview) =>
        this.createIssueFromView(payload, sourceWebview),
      createPullRequestFromView: async (payload: CreatePullRequestFromViewPayload, sourceWebview?: vscode.Webview) =>
        this.createPullRequestFromView(payload, sourceWebview),
      commentPullRequestFromView: async (payload: CommentPullRequestFromViewPayload, sourceWebview?: vscode.Webview) =>
        this.commentPullRequestFromView(payload, sourceWebview),
      findBoardItemById: (itemId: string) => findBoardItemById(this.snapshot, itemId),
      updateProjectFieldForItem: async (item: BoardItem) => this.updateProjectFieldForItem(item),
      updateLabelsForItem: async (item: BoardItem) => this.updateLabelsForItem(item),
      openUrl: async (url: string) => this.openUrl(url),
      getPullRequestInsights: async (repo: string, number: number) => this.dataService.getPullRequestInsights(repo, number),
      getActionRunLog: async (repo: string, runId: number) => this.dataService.getActionRunLog(repo, runId),
      retryActionRun: async (repo: string, runId: number, failedOnly: boolean) => this.dataService.retryActionRun(repo, runId, failedOnly),
      runWrite: async (action: () => Promise<void>) => this.runWrite(action),
      openAgentWorkspacePanel: async () => this.openAgentWorkspacePanel(),
      setSessionPinned: async (sessionId: string, pinned: boolean) => this.setSessionPinned(sessionId, pinned),
      archiveSession: async (sessionId: string) => this.archiveSession(sessionId),
      restoreSession: async (sessionId: string) => this.restoreSession(sessionId),
      sendAgentMessage: async (payload: AgentMessagePayload) => sendAgentMessageHandler(this.agentRuntimeHandlersDeps(), payload),
      dispatchAgent: async (payload: AgentDispatchPayload) => dispatchAgentHandler(this.agentRuntimeHandlersDeps(), payload),
      resolvePendingCommand: async (payload: AgentCommandDecisionPayload) =>
        resolvePendingCommandHandler(this.agentRuntimeHandlersDeps(), payload),
      stopAgent: async (payload: AgentStopPayload) => stopAgentHandler(this.agentRuntimeHandlersDeps(), payload),
      sendAgentTerminalInput: async (payload: AgentTerminalInputPayload) => this.sendAgentTerminalInput(payload),
      addActiveFileContext: async (sourceWebview?: vscode.Webview) =>
        addActiveFileContextHandler(this.agentRuntimeHandlersDeps(), sourceWebview),
      addSelectionContext: async (sourceWebview?: vscode.Webview) =>
        addSelectionContextHandler(this.agentRuntimeHandlersDeps(), sourceWebview),
      addWorkspaceFileContext: async (sourceWebview?: vscode.Webview) =>
        addWorkspaceFileContextHandler(this.agentRuntimeHandlersDeps(), sourceWebview),
      openSessionInEditor: async (sessionId: string) =>
        openSessionInEditorHandler(this.agentRuntimeHandlersDeps(), sessionId),
      openPullRequestByNumber: async (repo: string, number: number) =>
        openPullRequestByNumberHandler(this.agentRuntimeHandlersDeps(), repo, number),
      logInfo: (message: string) => this.logInfo(message),
      logWarn: (message: string) => this.logWarn(message)
    };
  }

  async updateProjectFieldCommand(): Promise<void> {
    const item = await pickBoardItem(this.snapshotPickerContext(), "Select issue to update project field");
    if (!item) {
      return;
    }
    await this.updateProjectFieldForItem(item);
  }

  async updateLabelsCommand(): Promise<void> {
    const item = await pickBoardItem(this.snapshotPickerContext(), "Select issue to update labels");
    if (!item) {
      return;
    }
    await this.updateLabelsForItem(item);
  }

  private async updateProjectFieldForItem(item: BoardItem): Promise<void> {
    const selectedField = await vscode.window.showQuickPick(PROJECT_FIELD_NAMES, {
      title: "Update Project Field",
      placeHolder: "Select field"
    });
    if (!selectedField) {
      return;
    }
    const fieldName = selectedField as ProjectFieldName;

    const options = await this.dataService.getFieldOptions(fieldName);
    if (options.length === 0) {
      vscode.window.showWarningMessage(`No options were returned for field '${fieldName}'.`);
      return;
    }

    const selectedOption = await vscode.window.showQuickPick(options, {
      title: `Set ${fieldName}`,
      placeHolder: "Select option"
    });
    if (!selectedOption) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Set ${fieldName} to '${selectedOption}' for #${item.issueNumber}?`,
      { modal: true },
      "Update"
    );
    if (confirm !== "Update") {
      return;
    }

    await this.runWrite(async () => {
      await this.dataService.updateProjectField(item, fieldName, selectedOption);
      vscode.window.showInformationMessage(`Updated ${fieldName} for #${item.issueNumber}.`);
    });
  }

  private async updateLabelsForItem(item: BoardItem): Promise<void> {
    const mode = await vscode.window.showQuickPick(["Add labels", "Remove labels"], {
      title: `Update Labels for #${item.issueNumber}`,
      placeHolder: "Choose action"
    });
    if (!mode) {
      return;
    }

    const rawLabels = await vscode.window.showInputBox({
      title: mode,
      placeHolder: "Comma-separated label names",
      validateInput: (value) => value.trim().length === 0 ? "At least one label is required." : undefined
    });
    if (!rawLabels) {
      return;
    }

    const labels = rawLabels
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (labels.length === 0) {
      return;
    }

    const addLabels = mode === "Add labels" ? labels : [];
    const removeLabels = mode === "Remove labels" ? labels : [];

    const confirm = await vscode.window.showWarningMessage(
      `${mode} on #${item.issueNumber}? (${labels.join(", ")})`,
      { modal: true },
      "Apply"
    );
    if (confirm !== "Apply") {
      return;
    }

    await this.runWrite(async () => {
      await this.dataService.updateLabels(item, addLabels, removeLabels);
      vscode.window.showInformationMessage(`Updated labels on #${item.issueNumber}.`);
    });
  }

  async createPullRequestCommand(): Promise<void> {
    const workspaceContext = await resolveCurrentWorkspaceContextHandler();
    await this.openCommandCenterForTabAction({
      tab: "pullRequests",
      openPullRequestCreate: true,
      preferredRepo: workspaceContext?.repoSlug ?? null
    });
  }

  async mergePullRequestCommand(): Promise<void> {
    const pr = await pickPullRequest(this.snapshotPickerContext(), "Select pull request to merge");
    if (!pr) {
      return;
    }

    const method = await vscode.window.showQuickPick(["squash", "merge", "rebase"], {
      title: `Merge PR #${pr.number}`,
      placeHolder: "Select merge strategy"
    });
    if (!method) {
      return;
    }

    const deleteBranchChoice = await vscode.window.showQuickPick(["Yes", "No"], {
      title: "Delete source branch after merge?",
      placeHolder: "Recommended: Yes"
    });
    if (!deleteBranchChoice) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Merge ${pr.repo}#${pr.number} with ${method}?`,
      { modal: true },
      "Merge"
    );
    if (confirm !== "Merge") {
      return;
    }

    await this.runWrite(async () => {
      await this.dataService.mergePullRequest({
        repo: pr.repo,
        number: pr.number,
        method: method as "merge" | "squash" | "rebase",
        deleteBranch: deleteBranchChoice === "Yes",
        auto: false
      });
      vscode.window.showInformationMessage(`Merged PR #${pr.number}.`);
    });
  }

  async commentPullRequestCommand(): Promise<void> {
    const pr = await pickPullRequest(this.snapshotPickerContext(), "Select pull request to comment on");
    if (!pr) {
      return;
    }

    const body = await vscode.window.showInputBox({
      title: `Comment on ${pr.repo}#${pr.number}`,
      placeHolder: "Comment body",
      validateInput: (value) => value.trim().length === 0 ? "Comment body is required." : undefined
    });
    if (!body) {
      return;
    }

    await this.runWrite(async () => {
      await this.dataService.commentPullRequest(pr.repo, pr.number, body.trim());
      vscode.window.showInformationMessage(`Comment posted on PR #${pr.number}.`);
    });
  }

  async openPullRequestCommand(): Promise<void> {
    const pr = await pickPullRequest(this.snapshotPickerContext(), "Select pull request to open");
    if (!pr?.url) {
      vscode.window.showWarningMessage("No pull request URL found.");
      return;
    }
    await this.openUrl(pr.url);
  }

  async openIssueCommand(): Promise<void> {
    const item = await pickBoardItem(this.snapshotPickerContext(), "Select issue to open");
    if (!item?.url) {
      vscode.window.showWarningMessage("No issue URL found on the selected item.");
      return;
    }

    await this.openUrl(item.url);
  }

  async openRunCommand(): Promise<void> {
    const run = await pickRun(this.snapshotPickerContext(), "Select workflow run to open");
    if (!run?.url) {
      vscode.window.showWarningMessage("No run URL found for the selected run.");
      return;
    }

    await this.openUrl(run.url);
  }

  async openSessionInEditorCommand(): Promise<void> {
    if (!this.snapshot || this.snapshot.agents.sessions.length === 0) {
      await this.refreshNow("manual");
    }

    if (!this.snapshot || this.snapshot.agents.sessions.length === 0) {
      vscode.window.showWarningMessage("No agent sessions are available.");
      return;
    }

    const selected = await vscode.window.showQuickPick(
      this.snapshot.agents.sessions.map((session) => ({
        label: `${session.agentId} (${session.transport})`,
        description: `${session.sessionId} | ${session.status}`,
        detail: `${session.repository ?? "(repo)"} | ${session.branch ?? "(branch)"} | ${session.workspace ?? "(workspace)"}`,
        session
      })),
      { title: "Open Agent Session in Editor", placeHolder: "Select session" }
    );

    if (!selected) {
      return;
    }

    await openSessionInEditorHandler(this.agentRuntimeHandlersDeps(), selected.session.sessionId);
  }

  async openUrl(url: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async openAgentWorkspacePanelCommand(): Promise<void> {
    await this.openAgentWorkspacePanel();
  }

  async jarvisActivateCommand(): Promise<void> {
    if (!this.jarvisIdentity?.isIdentityComplete) {
      await this.loadJarvisIdentity(true);
    }
    const prompt = await vscode.window.showInputBox({
      title: "Ask Jarvis",
      prompt: "Ask for a status report, session summary, joke, or approval action",
      placeHolder: "What is going on across sessions right now?",
      ignoreFocusOut: true
    });
    if (prompt === undefined) {
      return;
    }
    await this.activateJarvis(prompt.trim());
  }

  async jarvisAuditionPersonalitiesCommand(): Promise<void> {
    const settings = this.getRuntimeSettings();
    if (!settings.jarvisEnabled) {
      vscode.window.showWarningMessage("Jarvis is disabled. Enable phoenixOps.jarvisEnabled first.");
      return;
    }

    const scriptInput = await vscode.window.showInputBox({
      title: "Jarvis Personality Audition",
      prompt: "Script Jarvis should read for each personality mode.",
      value: "Phoenix operations check complete. Awaiting your next directive.",
      ignoreFocusOut: true
    });
    if (scriptInput === undefined) {
      return;
    }
    const auditionScript = scriptInput.trim() || "Phoenix operations check complete. Awaiting your next directive.";

    const artifactsRoot = this.resolveJarvisAuditionArtifactsRoot();
    if (!artifactsRoot) {
      vscode.window.showWarningMessage("No workspace folder is available for saving Jarvis audition artifacts.");
      return;
    }

    const supervisor = this.configuredSupervisorConnection();
    if (!supervisor.baseUrl) {
      vscode.window.showWarningMessage("Supervisor base URL is not configured. Set phoenixOps.supervisorBaseUrl first.");
      return;
    }

    await this.ensureWorkspaceSupervisorStarted();
    try {
      await this.waitForSupervisorSnapshotReady(
        supervisor.baseUrl,
        supervisor.authToken,
        Math.min(15_000, settings.workspaceSupervisorStartTimeoutMs)
      );
    } catch {
      // Continue; the audition endpoint may still be reachable.
    }

    const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runDir = path.join(artifactsRoot, runStamp);
    await fs.promises.mkdir(runDir, { recursive: true });

    const results: Array<{
      personality: JarvisPersonalityMode;
      source: string;
      text: string;
      audioFilePath: string | null;
      error: string | null;
    }> = [];

    await this.postStatus("Running Jarvis personality audition (serene, attentive, alert, escalating).", "ok");

    for (let index = 0; index < JARVIS_AUDITION_PERSONALITIES.length; index += 1) {
      const personality = JARVIS_AUDITION_PERSONALITIES[index];
      try {
        await this.postStatus(
          `Jarvis audition ${index + 1}/${JARVIS_AUDITION_PERSONALITIES.length}: ${personality}`,
          "warn"
        );

        const response = await this.requestJarvisRespondForAudition({
          baseUrl: supervisor.baseUrl,
          authToken: supervisor.authToken,
          script: auditionScript,
          personality,
          model: settings.jarvisTextModel
        });

        let audioFilePath: string | null = null;
        if (response.audioBase64) {
          audioFilePath = await this.writeJarvisAuditionAudio(runDir, index + 1, personality, response.mimeType, response.audioBase64);
          await this.emitJarvisPayload(
            {
              text: `[audition:${personality}] ${response.text}`,
              reason: `personality-audition-${personality}`,
              auto: false,
              focusHint: null,
              mimeType: response.mimeType,
              audioBase64: response.audioBase64
            },
            false
          );
        } else {
          this.logWarn(`Jarvis audition (${personality}) returned no audio payload.`);
        }

        results.push({
          personality,
          source: response.source,
          text: response.text,
          audioFilePath,
          error: null
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logWarn(`Jarvis audition (${personality}) failed: ${message}`);
        results.push({
          personality,
          source: "error",
          text: "",
          audioFilePath: null,
          error: message
        });
      }

      await this.sleep(150);
    }

    const manifestPath = path.join(runDir, "manifest.json");
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          script: auditionScript,
          supervisorBaseUrl: supervisor.baseUrl,
          personalities: results
        },
        null,
        2
      ),
      "utf8"
    );

    const playable = results.filter((entry) => entry.audioFilePath).length;
    await this.postStatus(`Jarvis audition complete. Saved ${playable}/${results.length} clips to ${runDir}.`, "ok");

    const openChoice = await vscode.window.showInformationMessage(
      `Jarvis personality audition complete. Saved clips to ${runDir}`,
      "Open Folder"
    );
    if (openChoice === "Open Folder") {
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(runDir));
    }
  }

  async jarvisToggleManualModeCommand(): Promise<void> {
    this.jarvisManualMode = !this.jarvisManualMode;
    await this.context.globalState.update(JARVIS_MANUAL_MODE_STORAGE_KEY, this.jarvisManualMode);
    await this.postJarvisState();
    vscode.window.showInformationMessage(
      this.jarvisManualMode
        ? "Jarvis manual mode enabled. Automatic announcements are paused."
        : "Jarvis automatic announcements resumed."
    );
  }

  getSnapshot(): DashboardSnapshot | null {
    return this.snapshot;
  }

  private isLocalSupervisorBaseUrl(baseUrl: string): boolean {
    try {
      const parsed = new URL(baseUrl);
      const host = parsed.hostname.toLowerCase();
      return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "0.0.0.0";
    } catch {
      return false;
    }
  }

  private configuredSupervisorConnection(): { baseUrl: string; authToken: string } {
    const settings = this.getRuntimeSettings();
    return {
      baseUrl: settings.supervisorBaseUrl.replace(/\/$/, ""),
      authToken: settings.supervisorAuthToken
    };
  }

  private async ensureWorkspaceSupervisorStarted(): Promise<void> {
    const settings = this.dataService.getSettings();
    if (!settings.workspaceSupervisorAutoStart) {
      this.logInfo("Workspace supervisor auto-start disabled.");
      return;
    }

    const baseUrl = settings.supervisorBaseUrl.replace(/\/$/, "");
    if (!baseUrl || !this.isLocalSupervisorBaseUrl(baseUrl)) {
      if (baseUrl) {
        this.logInfo(`Workspace supervisor auto-start skipped for non-local base URL: ${baseUrl}`);
      }
      return;
    }

    try {
      this.logInfo(`Ensuring workspace supervisor is running at ${baseUrl}.`);
      const startedBaseUrl = await this.workspaceSupervisorManager.ensureStarted({
        baseUrl,
        apiToken: settings.supervisorAuthToken,
        repoPath: settings.workspaceSupervisorRepoPath,
        startTimeoutMs: settings.workspaceSupervisorStartTimeoutMs,
        runBootstrapOnAutoStart: settings.workspaceSupervisorRunBootstrapOnAutoStart,
        codexCliPath: settings.codexCliPath,
        copilotCliPath: settings.copilotCliPath,
        claudeCliPath: settings.claudeCliPath,
        geminiCliPath: settings.geminiCliPath,
        jarvisApiBaseUrl: settings.jarvisApiBaseUrl,
        jarvisApiKey: settings.jarvisApiKey,
        jarvisTextModel: settings.jarvisTextModel,
        jarvisSpeechModel: settings.jarvisSpeechModel,
        jarvisVoice: settings.jarvisVoice,
        jarvisTtsProvider: settings.jarvisTtsProvider,
        jarvisGeminiApiKey: settings.jarvisGeminiApiKey,
        jarvisGeminiModel: settings.jarvisGeminiModel,
        jarvisGeminiVoice: settings.jarvisGeminiVoice,
        jarvisGeminiLiveModel: settings.jarvisGeminiLiveModel,
        jarvisTtsDebug: settings.jarvisTtsDebug,
        jarvisHardCooldownSeconds: settings.jarvisPollinationsHardCooldownSeconds,
        jarvisSoftCooldownSeconds: settings.jarvisPollinationsSoftCooldownSeconds
      });
      this.logInfo(`Workspace supervisor online at ${startedBaseUrl}.`);
      await this.postStatus(`Workspace supervisor online at ${startedBaseUrl}`, "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logError(`Workspace supervisor startup failed: ${message}`);
      await this.postStatus(`Workspace supervisor startup failed: ${message}`, "warn");
    }
  }

  private getRuntimeSettings(): ReturnType<DataService["getSettings"]> {
    const settings = this.dataService.getSettings();
    if (settings.workspaceSupervisorAutoStart) {
      return settings;
    }
    if (!this.embeddedSupervisorBaseUrl || !settings.embeddedSupervisorEnabled || !settings.useSupervisorStream) {
      return settings;
    }
    return {
      ...settings,
      supervisorBaseUrl: this.embeddedSupervisorBaseUrl,
      supervisorAuthToken: this.embeddedSupervisorToken
    };
  }

  private async ensureEmbeddedSupervisorStarted(): Promise<void> {
    await ensureEmbeddedSupervisorStartedHandler(this.embeddedSupervisorHandlersDeps());
  }

  private startEmbeddedSupervisorSyncLoop(): void {
    const settings = this.dataService.getSettings();
    if (
      this.embeddedSupervisorSyncTimer ||
      !this.embeddedSupervisorBaseUrl ||
      !settings.embeddedSupervisorEnabled ||
      settings.workspaceSupervisorAutoStart
    ) {
      return;
    }
    this.embeddedSupervisorSyncTimer = setInterval(() => {
      void this.syncEmbeddedSupervisorNow("poll");
    }, Math.max(10, settings.refreshSeconds) * 1000);
  }

  private async syncEmbeddedSupervisorNow(reason: RefreshReason): Promise<boolean> {
    return await syncEmbeddedSupervisorNowHandler(this.embeddedSupervisorHandlersDeps(), reason);
  }

  private startJarvisAutoLoop(): void {
    if (this.jarvisAutoTimer) {
      return;
    }
    this.jarvisAutoTimer = setInterval(() => {
      void this.tickJarvisAuto();
    }, JARVIS_AUTO_LOOP_MS);
  }

  private async tickJarvisAuto(): Promise<void> {
    await tickJarvisAutoHandler(this.jarvisInteractionHandlersDeps());
  }

  private canAnnounceJarvis(reason: string, settings: ReturnType<DataService["getSettings"]>): boolean {
    const now = Date.now();
    this.pruneJarvisAnnouncementHistory(now);
    const reasonCooldownMs = settings.jarvisReasonCooldownMinutes * 60_000;
    const previousReasonMs = this.jarvisReasonCooldownMs.get(reason) ?? 0;

    if (this.jarvisAnnouncementMsHistory.length >= settings.jarvisMaxAnnouncementsPerHour) {
      return false;
    }
    if (now - this.jarvisLastAnnouncementMs < settings.jarvisMinSecondsBetweenAnnouncements * 1000) {
      return false;
    }
    if (previousReasonMs > 0 && now - previousReasonMs < reasonCooldownMs) {
      return false;
    }
    return true;
  }

  private pruneJarvisAnnouncementHistory(now = Date.now()): void {
    while (this.jarvisAnnouncementMsHistory.length > 0 && now - this.jarvisAnnouncementMsHistory[0] > 60 * 60_000) {
      this.jarvisAnnouncementMsHistory.shift();
    }
  }

  private rememberJarvisTurn(role: "user" | "assistant", content: string, historyTurns: number): void {
    const clean = content.trim();
    if (!clean) {
      return;
    }
    this.jarvisConversation.push({ role, content: clean });
    const maxTurns = Math.max(2, historyTurns);
    const maxMessages = maxTurns * 2;
    if (this.jarvisConversation.length > maxMessages) {
      this.jarvisConversation.splice(0, this.jarvisConversation.length - maxMessages);
    }
    this.persistJarvisSessionMemory(false);
  }

  private currentWorkspaceName(): string {
    return vscode.workspace.name ?? "Phoenix Ops";
  }

  private currentJarvisSnapshotFacts() {
    return buildJarvisSessionSnapshot(this.snapshot);
  }

  private currentJarvisSessionSummary(): string {
    return buildJarvisSessionSummary({
      workspaceName: this.currentWorkspaceName(),
      snapshot: this.currentJarvisSnapshotFacts(),
      turns: this.jarvisConversation
    });
  }

  private persistJarvisSessionMemory(markEnded: boolean): void {
    this.jarvisSessionMemory = upsertJarvisSessionMemory(
      this.jarvisSessionMemory,
      {
        sessionId: this.jarvisSessionId,
        workspaceName: this.currentWorkspaceName(),
        startedAt: this.vscodeSessionStartedAtIso,
        endedAt: markEnded ? new Date().toISOString() : null,
        summary: this.currentJarvisSessionSummary(),
        snapshot: this.currentJarvisSnapshotFacts(),
        turns: this.jarvisConversation
      },
      {
        maxSessions: JARVIS_SESSION_MEMORY_MAX_SESSIONS,
        maxTurnsPerSession: JARVIS_SESSION_MEMORY_MAX_TURNS
      }
    );

    const persisted = persistJarvisSessionMemory(this.jarvisSessionMemoryFilePath, this.jarvisSessionMemory);
    if (!persisted) {
      this.logWarn("Failed to persist Jarvis session memory to disk.");
    }
  }

  private async activateJarvis(prompt: string): Promise<void> {
    await activateJarvisHandler(this.jarvisInteractionHandlersDeps(), prompt);
  }

  private async loadJarvisIdentity(interactive = true): Promise<void> {
    // Try loading from disk / env vars first
    const stored = readJarvisIdentityFromDisk();
    if (stored && stored.isIdentityComplete) {
      this.jarvisIdentity = stored;
      this.logInfo(`[Jarvis] Identity loaded: ${stored.name}`);
      return;
    }

    if (!interactive) {
      this.jarvisIdentity = { name: null, preferredPronouns: "they/them", isIdentityComplete: false };
      this.logInfo("[Jarvis] Identity prompt skipped during startup — defaulting to neutral form.");
      return;
    }

    // Ask once via VS Code input box — non-blocking, user can dismiss
    const name = await vscode.window.showInputBox({
      title: "Jarvis — Who are you?",
      prompt: "What should Jarvis call you? (Press Escape to skip)",
      placeHolder: "e.g. Alex",
      ignoreFocusOut: true
    });

    if (!name || !name.trim()) {
      this.logInfo("[Jarvis] Identity setup skipped — will address as 'sir'.");
      this.jarvisIdentity = { name: null, preferredPronouns: "they/them", isIdentityComplete: false };
      return;
    }

    const pronounChoice = await vscode.window.showQuickPick(
      [
        { label: "he/him", description: "He/Him" },
        { label: "she/her", description: "She/Her" },
        { label: "they/them", description: "They/Them (default)" },
        { label: "other", description: "Prefer not to specify" }
      ],
      { title: `Nice to meet you, ${name.trim()}. How should Jarvis address you?`, ignoreFocusOut: true }
    );

    const identity: JarvisIdentity = {
      name: name.trim(),
      preferredPronouns: (pronounChoice?.label ?? "they/them") as JarvisIdentity["preferredPronouns"],
      isIdentityComplete: true
    };
    this.jarvisIdentity = identity;
    writeJarvisIdentityToDisk(identity);
    this.logInfo(`[Jarvis] Identity saved: ${identity.name} (${identity.preferredPronouns})`);
  }

  private async sendJarvisStartupGreeting(): Promise<void> {
    const settings = this.getRuntimeSettings();
    if (!settings.jarvisEnabled) {
      return;
    }

    this.persistJarvisSessionMemory(false);
    const workspaceName = this.currentWorkspaceName();
    const priorSummaries = listRecentStartupAgentSessionSummaries(this.snapshot, JARVIS_STARTUP_PRIOR_SUMMARY_COUNT);
    const greeting = buildJarvisStartupGreeting({
      workspaceName,
      operatorName: this.jarvisIdentity?.name ?? null,
      snapshot: this.currentJarvisSnapshotFacts(),
      priorSessionSummaries: priorSummaries
    });

    this.logInfo(
      `Sending Jarvis startup greeting from extension snapshot (priorSessionSummaries=${priorSummaries.length}, sessionId=${this.jarvisSessionId}).`
    );
    this.rememberJarvisTurn("assistant", greeting, settings.jarvisConversationHistoryTurns);
    await this.emitJarvisSpeech({
      text: greeting,
      reason: "startup-greeting",
      auto: false,
      focusHint: null,
      personality: "serene"
    });
  }

  private async tryJarvisDelegatedApproval(
    prompt: string,
    snapshot: DashboardSnapshot
  ): Promise<{ text: string; reason: string; focusHint: JarvisFocusHint | null } | null> {
    return await tryJarvisDelegatedApprovalHandler(this.jarvisDelegatedApprovalDeps(), prompt, snapshot);
  }

  private getJarvisServiceSettings(settings: ReturnType<DataService["getSettings"]>): {
    apiBaseUrl: string;
    apiKey: string;
    textModel: string;
    speechModel: string;
    voice: string;
    ttsProvider: "gemini-with-fallback" | "gemini" | "pollinations";
    geminiApiKey: string;
    geminiModel: string;
    geminiVoice: string;
    ttsDebug: boolean;
  } {
    return {
      apiBaseUrl: settings.jarvisApiBaseUrl,
      apiKey: settings.jarvisApiKey,
      textModel: settings.jarvisTextModel,
      speechModel: settings.jarvisSpeechModel,
      voice: settings.jarvisVoice,
      ttsProvider: settings.jarvisTtsProvider,
      geminiApiKey: settings.jarvisGeminiApiKey,
      geminiModel: settings.jarvisGeminiModel,
      geminiVoice: settings.jarvisGeminiVoice,
      ttsDebug: settings.jarvisTtsDebug
    };
  }

  private async emitJarvisPayload(payload: JarvisSpeakPayload, forwardToSupervisor: boolean): Promise<void> {
    const clean = payload.text.trim();
    if (!clean) {
      return;
    }

    payload.text = clean;
    if (payload.auto) {
      const now = Date.now();
      this.jarvisLastAnnouncementMs = now;
      this.jarvisAnnouncementMsHistory.push(now);
      this.jarvisReasonCooldownMs.set(payload.reason, now);
      this.pruneJarvisAnnouncementHistory(now);
    }

    this.jarvisLastMessage = clean;
    this.jarvisLastReason = payload.reason;
    const webviewPayload: JarvisSpeakPayload = { ...payload };
    if (webviewPayload.audioBase64) {
      const runtimeSettings = this.getRuntimeSettings();
      const queuedOnHost = this.jarvisHostAudioPlayer.enqueue({
        audioBase64: webviewPayload.audioBase64,
        mimeType: webviewPayload.mimeType,
        reason: webviewPayload.reason,
        auto: webviewPayload.auto,
        spacingAfterMs: runtimeSettings.jarvisHostPlaybackSpacingMs
      });
      if (queuedOnHost) {
        webviewPayload.audioHandledByHost = true;
        webviewPayload.audioBase64 = null;
        webviewPayload.mimeType = null;
        this.logInfo(`[jarvis-audio-host] queued playback (reason=${webviewPayload.reason}, auto=${webviewPayload.auto}).`);
      } else {
        webviewPayload.audioHandledByHost = false;
      }
    }

    await this.postMessageToAllWebviews("jarvisSpeak", webviewPayload);
    await this.postJarvisState();
    if (forwardToSupervisor) {
      void this.forwardJarvisSpeakToSupervisor(payload);
    }
  }

  private async requestJarvisRespondFromSupervisor(input: {
    prompt: string;
    reason: string;
    auto: boolean;
    focusHint: JarvisFocusHint | null;
    rememberPrompt: string | null;
    warnOnFailure: boolean;
  }): Promise<boolean> {
    return await requestJarvisRespondFromSupervisorHandler(this.jarvisSupervisorHandlersDeps(), input);
  }

  private async emitJarvisSpeech(input: {
    text: string;
    reason: string;
    auto: boolean;
    focusHint: JarvisFocusHint | null;
    personality?: JarvisPersonalityMode;
  }): Promise<void> {
    const clean = input.text.trim();
    if (!clean) {
      return;
    }

    const settings = this.getRuntimeSettings();
    const jarvisServiceSettings = this.getJarvisServiceSettings(settings);
    const geminiConfigured = jarvisServiceSettings.geminiApiKey.trim().length > 0;
    let speech: JarvisSpeechResult | null = null;
    const ttsInstructions = buildJarvisTtsInstructions(input.personality ?? "attentive");
    const shouldApplyPollinationsCooldown = jarvisServiceSettings.ttsProvider !== "gemini";

    this.logInfo(
      `[jarvis-tts] request mode=${jarvisServiceSettings.ttsProvider} ` +
      `geminiKey=${geminiConfigured ? "configured" : "missing"} ` +
      `geminiModel=${jarvisServiceSettings.geminiModel} geminiVoice=${jarvisServiceSettings.geminiVoice} ` +
      `pollinationsModel=${jarvisServiceSettings.speechModel} pollinationsVoice=${jarvisServiceSettings.voice}`
    );

    if (jarvisServiceSettings.ttsProvider !== "pollinations" && !geminiConfigured) {
      const warning = jarvisServiceSettings.ttsProvider === "gemini"
        ? "Gemini mode is selected but phoenixOps.jarvisGeminiApiKey is missing."
        : "Gemini fallback mode is selected but phoenixOps.jarvisGeminiApiKey is missing. Pollinations-only speech will be used.";
      this.logWarn(`[jarvis-tts] ${warning}`);
      if (jarvisServiceSettings.ttsProvider === "gemini") {
        await this.postStatus(warning, "warn");
      }
    }

    const speechCooldown = this.jarvisPollinationsCooldown.snapshot("speech");
    if (!shouldApplyPollinationsCooldown || !speechCooldown.degraded || !speechCooldown.untilMs) {
      try {
        speech = await this.jarvisService.synthesizeSpeech(clean, jarvisServiceSettings, ttsInstructions);
        this.logInfo(
          `[jarvis-tts] success provider=${speech.provider} mode=${speech.mode} ` +
          `fallback=${speech.usedFallback} mimeType=${speech.mimeType} bytesBase64=${speech.audioBase64.length}`
        );
        if (speech.geminiAttempted && speech.provider === "pollinations" && speech.geminiError) {
          this.logWarn(`[jarvis-tts] Gemini failed; fallback provider=pollinations error=${speech.geminiError}`);
        }
        this.clearPollinationsCooldown("speech");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (jarvisServiceSettings.ttsProvider === "gemini") {
          this.logWarn(`[jarvis-tts] Gemini synthesis failed: ${message}`);
          await this.postStatus(`Jarvis Gemini TTS failed: ${message}`, "warn");
        } else {
          this.notePollinationsFailure("speech", error, settings);
        }
      }
    } else {
      this.logWarn(
        `[jarvis-tts] skipped speech due Pollinations cooldown (until=${new Date(speechCooldown.untilMs).toISOString()})`
      );
    }

    const payload: JarvisSpeakPayload = {
      text: clean,
      reason: input.reason,
      auto: input.auto,
      focusHint: input.focusHint,
      mimeType: speech?.mimeType ?? null,
      audioBase64: speech?.audioBase64 ?? null
    };

    await this.emitJarvisPayload(payload, true);
  }

  private async requestJarvisRespondForAudition(input: {
    baseUrl: string;
    authToken: string;
    script: string;
    personality: JarvisPersonalityMode;
    model: string;
  }): Promise<{
    text: string;
    source: string;
    mimeType: string | null;
    audioBase64: string | null;
  }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (input.authToken) {
      headers.Authorization = `Bearer ${input.authToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${input.baseUrl}/jarvis/respond`, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          sessionId: "jarvis-voice",
          agentId: "Jarvis",
          transport: "local",
          prompt: `Voice audition. Return exactly this text with no extra words: \"${input.script}\"`,
          reason: `personality-audition-${input.personality}`,
          auto: false,
          includeAudio: true,
          personality: input.personality,
          service: "jarvis",
          mode: "voice",
          model: input.model,
          workspace: defaultWorkspacePath(),
          occurredAt: new Date().toISOString()
        })
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Supervisor /jarvis/respond failed (HTTP ${response.status})${details ? `: ${details}` : ""}`);
      }

      const raw = (await response.json()) as SupervisorJarvisRespondPayload;
      if (raw.accepted === false) {
        throw new Error("Supervisor /jarvis/respond rejected the request.");
      }

      const text = typeof raw.text === "string" ? raw.text.trim() : "";
      if (!text) {
        throw new Error("Supervisor /jarvis/respond returned no text.");
      }

      return {
        text,
        source: typeof raw.source === "string" ? raw.source : "unknown",
        mimeType: typeof raw.mimeType === "string" ? raw.mimeType : null,
        audioBase64: typeof raw.audioBase64 === "string" ? raw.audioBase64 : null
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private resolveJarvisAuditionArtifactsRoot(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
      return null;
    }

    const preferred = workspaceFolders.find((folder) =>
      path.basename(folder.uri.fsPath).toLowerCase() === "phoenix-agentic-vscode-commandcenter"
    );
    const basePath = preferred?.uri.fsPath ?? workspaceFolders[0]?.uri.fsPath;
    if (!basePath) {
      return null;
    }

    return path.join(basePath, "artifacts", "jarvis-auditions");
  }

  private async writeJarvisAuditionAudio(
    runDir: string,
    index: number,
    personality: JarvisPersonalityMode,
    mimeType: string | null,
    audioBase64: string
  ): Promise<string> {
    const normalized = this.normalizeJarvisAudioBase64(audioBase64);
    const bytes = Buffer.from(normalized, "base64");
    if (!bytes.length) {
      throw new Error(`Empty audio payload for personality ${personality}.`);
    }

    const extension = this.jarvisAudioExtensionFromMimeType(mimeType);
    const fileName = `${String(index).padStart(2, "0")}-${personality}.${extension}`;
    const filePath = path.join(runDir, fileName);
    await fs.promises.writeFile(filePath, bytes);
    return filePath;
  }

  private normalizeJarvisAudioBase64(input: string): string {
    const trimmed = String(input || "").trim();
    if (!trimmed) {
      return "";
    }
    const separator = trimmed.indexOf(",");
    const payload = separator >= 0 ? trimmed.slice(separator + 1) : trimmed;
    return payload.replace(/\s+/g, "");
  }

  private jarvisAudioExtensionFromMimeType(mimeType: string | null): string {
    const normalized = String(mimeType || "").toLowerCase();
    if (normalized.includes("wav")) {
      return "wav";
    }
    if (normalized.includes("ogg")) {
      return "ogg";
    }
    if (normalized.includes("aac") || normalized.includes("m4a") || normalized.includes("mp4")) {
      return "m4a";
    }
    return "mp3";
  }

  private pollinationsCooldownNotice(
    channel: "chat" | "speech",
    failureKind: PollinationsFailureKind | null,
    untilMs: number
  ): string {
    const kind = failureKind ?? "unknown";
    return `Pollinations ${channel} cooldown is active (${kind}) until ${new Date(untilMs).toISOString()}.`;
  }

  private clearPollinationsCooldown(channel: "chat" | "speech"): void {
    const current = this.jarvisPollinationsCooldown.snapshot(channel);
    if (!current.degraded && !current.failureKind) {
      return;
    }
    this.jarvisPollinationsCooldown.clear(channel);
    void this.postJarvisState();
  }

  private notePollinationsFailure(
    channel: "chat" | "speech",
    error: unknown,
    settings: ReturnType<DataService["getSettings"]>
  ): string {
    const normalized = normalizePollinationsFailure(error, {
      endpoint: settings.jarvisApiBaseUrl,
      channel,
      messagePrefix: `Pollinations ${channel} request failed`
    });

    const { untilMs } = this.jarvisPollinationsCooldown.noteFailure(
      channel,
      normalized,
      {
        hardCooldownSeconds: settings.jarvisPollinationsHardCooldownSeconds,
        softCooldownSeconds: settings.jarvisPollinationsSoftCooldownSeconds
      }
    );

    if (this.jarvisPollinationsCooldown.shouldWarn(channel, untilMs)) {
      this.jarvisPollinationsCooldown.markWarned(channel, untilMs);
      void this.postStatus(
        `Jarvis ${channel} API degraded (${normalized.kind}). Cooldown until ${new Date(untilMs).toISOString()}.`,
        "warn"
      );
    }

    void this.postJarvisState();
    return normalized.message;
  }

  private async forwardJarvisSpeakToSupervisor(payload: JarvisSpeakPayload): Promise<void> {
    await forwardJarvisSpeakToSupervisorHandler(this.jarvisSupervisorHandlersDeps(), payload);
  }

  private jarvisStatePayload(): JarvisStatePayload {
    const settings = this.getRuntimeSettings();
    const chat = this.jarvisPollinationsCooldown.snapshot("chat");
    const speech = this.jarvisPollinationsCooldown.snapshot("speech");
    this.pruneJarvisAnnouncementHistory(Date.now());
    return {
      enabled: settings.jarvisEnabled,
      manualMode: this.jarvisManualMode,
      autoAnnouncements: settings.jarvisAutoAnnouncements,
      maxAnnouncementsPerHour: settings.jarvisMaxAnnouncementsPerHour,
      minSecondsBetweenAnnouncements: settings.jarvisMinSecondsBetweenAnnouncements,
      announcementsLastHour: this.jarvisAnnouncementMsHistory.length,
      lastReason: this.jarvisLastReason,
      lastMessage: this.jarvisLastMessage,
      chatDegraded: chat.degraded,
      chatFailureKind: chat.failureKind,
      chatCooldownUntil: chat.untilMs ? new Date(chat.untilMs).toISOString() : null,
      speechDegraded: speech.degraded,
      speechFailureKind: speech.failureKind,
      speechCooldownUntil: speech.untilMs ? new Date(speech.untilMs).toISOString() : null
    };
  }

  private async postJarvisState(sourceWebview?: vscode.Webview): Promise<void> {
    await this.postWebviewResponse(sourceWebview, "jarvisState", this.jarvisStatePayload());
  }

  private async handleIncomingMessage(message: { type?: unknown; command?: unknown; url?: unknown }, sourceWebview?: vscode.Webview): Promise<void> {
    await routeWebviewMessage(this.webviewMessageRouterContext(), message, sourceWebview);
  }

  private async openAgentWorkspacePanel(): Promise<void> {
    const revealed = this.agentViewProvider.show(false);
    if (!revealed) {
      try {
        await vscode.commands.executeCommand("workbench.view.extension.phoenixOpsAgent");
      } catch {
        // Best effort: if the container command is unavailable, continue without failing activation.
      }
      this.agentViewProvider.show(false);
    }
    await this.pushSnapshot();
    await this.postAuthState();
    await this.postJarvisState();
  }

  private async openSessionPanel(sessionId: string): Promise<void> {
    const existing = this.sessionPanels.get(sessionId);
    if (existing) {
      existing.reveal(vscode.ViewColumn.Beside, false);
      await this.pushSnapshot();
      await this.postAuthState();
      return;
    }

    const panel = this.createSessionPanel(sessionId);
    this.sessionPanels.set(sessionId, panel);
    panel.onDidDispose(() => {
      this.sessionPanels.delete(sessionId);
    }, null, this.context.subscriptions);
    await this.pushSnapshot();
    await this.postAuthState();
    await this.postJarvisState();
  }

  private createSessionPanel(lockedSessionId: string): vscode.WebviewPanel {
    const title = `Phoenix Ops Agent: ${lockedSessionId}`;
    const panel = vscode.window.createWebviewPanel(
      "phoenixOps.agentSessionEditor",
      title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          this.context.extensionUri,
          vscode.Uri.joinPath(this.context.extensionUri, "media")
        ]
      }
    );

    panel.webview.html = this.agentViewProvider.getHtml(panel.webview, {
      mode: "agent-only",
      lockedSessionId
    });
    panel.webview.onDidReceiveMessage((message) => {
      void this.handleIncomingMessage(message as { type?: unknown; command?: unknown; url?: unknown }, panel.webview);
    }, null, this.context.subscriptions);

    return panel;
  }

  dispose(): void {
    this.persistJarvisSessionMemory(true);
    this.disposed = true;
    this.closeAllTerminalStreams();
    this.streamClient.dispose();
    this.jarvisHostAudioPlayer.dispose();
    this.sessionPanels.forEach((panel) => panel.dispose());
    this.sessionPanels.clear();
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    if (this.jarvisAutoTimer) {
      clearInterval(this.jarvisAutoTimer);
      this.jarvisAutoTimer = null;
    }
    if (this.startupCliBootstrapTimer) {
      clearTimeout(this.startupCliBootstrapTimer);
      this.startupCliBootstrapTimer = null;
    }
    if (this.embeddedSupervisorSyncTimer) {
      clearInterval(this.embeddedSupervisorSyncTimer);
      this.embeddedSupervisorSyncTimer = null;
    }
    this.cliAuthWatchTimers.forEach((timer) => clearInterval(timer));
    this.cliAuthWatchTimers.clear();
    this.workspaceSupervisorManager.dispose();
    this.embeddedSupervisorManager.dispose();
    this.output.dispose();
  }

  private async runWrite(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      await this.refreshNow("write");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Phoenix Command Center write failed: ${message}`);
    }
  }

  private async issueCreateMetadataRequest(payload: IssueCreateMetadataRequestPayload, sourceWebview?: vscode.Webview): Promise<void> {
    await issueCreateMetadataRequestHandler(this.issuePullRequestHandlersDeps(), payload, sourceWebview);
  }

  private async createIssueFromView(payload: CreateIssueFromViewPayload, sourceWebview?: vscode.Webview): Promise<void> {
    await createIssueFromViewHandler(this.issuePullRequestHandlersDeps(), payload, sourceWebview);
  }

  private async createPullRequestFromView(payload: CreatePullRequestFromViewPayload, sourceWebview?: vscode.Webview): Promise<void> {
    await createPullRequestFromViewHandler(this.issuePullRequestHandlersDeps(), payload, sourceWebview);
  }

  private async commentPullRequestFromView(payload: CommentPullRequestFromViewPayload, sourceWebview?: vscode.Webview): Promise<void> {
    await commentPullRequestFromViewHandler(this.issuePullRequestHandlersDeps(), payload, sourceWebview);
  }

  private async openCommandCenterForTabAction(payload: {
    tab: "board" | "issues" | "actions" | "pullRequests";
    openIssueCreate?: boolean;
    openPullRequestCreate?: boolean;
    preferredRepo?: string | null;
  }): Promise<void> {
    await openCommandCenterForTabActionHandler(this.issuePullRequestHandlersDeps(), payload);
  }

  private async postRuntimeContext(sourceWebview?: vscode.Webview): Promise<void> {
    await postRuntimeContextHandler(this.issuePullRequestHandlersDeps(), sourceWebview);
  }

  private async restartSupervisorDataFlow(): Promise<void> {
    this.closeAllTerminalStreams();
    this.streamClient.dispose();
    this.streamConnected = false;
    this.stopPolling();

    if (this.embeddedSupervisorSyncTimer) {
      clearInterval(this.embeddedSupervisorSyncTimer);
      this.embeddedSupervisorSyncTimer = null;
    }

    await this.ensureWorkspaceSupervisorStarted();
    await this.ensureEmbeddedSupervisorStarted();

    const runtimeSettings = this.getRuntimeSettings();
    if (this.embeddedSupervisorBaseUrl && runtimeSettings.useSupervisorStream) {
      await this.syncEmbeddedSupervisorNow("manual");
      this.startEmbeddedSupervisorSyncLoop();
    }

    await this.startDataFlow();
    await this.refreshNow("manual");
    await this.postRuntimeContext();
  }

  private resolveAvailableMcpToolIds(): string[] {
    const config = vscode.workspace.getConfiguration("phoenixOps");
    const configured = config.get<string[]>("mcpToolOptions", []);
    const configuredTools = Array.isArray(configured)
      ? configured.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
      : [];

    const settings = vscode.workspace.getConfiguration();
    const rawMcpServers =
      settings.get<Record<string, unknown>>("mcp.servers", {}) ??
      vscode.workspace.getConfiguration("mcp").get<Record<string, unknown>>("servers", {});
    const serverNames = rawMcpServers && typeof rawMcpServers === "object"
      ? Object.keys(rawMcpServers).map((server) => `server:${server}`)
      : [];

    const merged = [...configuredTools, ...serverNames];
    return [...new Set(merged)].sort((left, right) => left.localeCompare(right));
  }

  private invalidateAgentModelCatalogCache(): void {
    invalidateAgentModelCatalogCacheHandler(this.agentModelCatalogHandlersDeps());
  }

  private async resolveAgentModelCatalog(
    settings: ReturnType<DataService["getSettings"]>
  ): Promise<AgentModelCatalogPayload> {
    return await resolveAgentModelCatalogHandler(this.agentModelCatalogHandlersDeps(), settings);
  }

  private async startDataFlow(): Promise<void> {
    await startDataFlowHandler(this.supervisorFlowHandlersDeps());
  }

  private async tryStartSupervisorStream(): Promise<boolean> {
    return await tryStartSupervisorStreamHandler(this.supervisorFlowHandlersDeps());
  }

  private startPolling(): void {
    if (this.pollingTimer) {
      return;
    }

    const settings = this.getRuntimeSettings();
    const intervalMs = settings.refreshSeconds * 1000;

    this.pollingTimer = setInterval(() => {
      void this.refreshNow("poll");
    }, intervalMs);

    void this.postStatus(settings.useSupervisorStream ? "Polling supervisor snapshot" : "Polling GitHub", "warn");
  }

  private stopPolling(): void {
    if (!this.pollingTimer) {
      return;
    }
    clearInterval(this.pollingTimer);
    this.pollingTimer = null;
  }

  private startStaleMonitor(): void {
    if (this.staleTimer) {
      return;
    }

    this.staleTimer = setInterval(() => {
      if (!this.snapshot) {
        return;
      }

      const refreshWindowMs = this.getRuntimeSettings().refreshSeconds * 2000;
      const stale = Date.now() - this.lastUpdatedMs > refreshWindowMs;
      if (stale !== this.snapshot.meta.stale) {
        this.snapshot.meta.stale = stale;
        void this.pushSnapshot();
      }
    }, 5000);
  }

  private async refreshNow(reason: RefreshReason): Promise<void> {
    const settings = this.getRuntimeSettings();

    try {
      this.sequence += 1;

      if (settings.useSupervisorStream) {
        if (this.embeddedSupervisorBaseUrl) {
          await this.syncEmbeddedSupervisorNow(reason);
        }
        const refreshedFromSupervisor = await this.refreshFromSupervisor(reason);
        if (refreshedFromSupervisor) {
          if (reason === "manual") {
            void this.postStatus("Manual refresh complete (supervisor)", "ok");
          }
          return;
        }

        if (!settings.allowDirectGhPollingFallback) {
          if (this.snapshot) {
            this.snapshot.meta.stale = true;
            this.snapshot.meta.streamConnected = false;
            this.snapshot.meta.generatedAt = new Date().toISOString();
            await this.pushSnapshot();
          }

          if (reason !== "poll") {
            void this.postStatus("Supervisor unavailable; direct gh fallback is disabled", "err");
          }
          return;
        }
      }

      const snapshot = await this.dataService.fetchLocalSnapshot(this.sequence, this.streamConnected, false, reason);
      this.acceptSnapshot(snapshot);

      if (snapshot.meta.stale) {
        void this.postStatus("Using cached data (rate-limited or cooling down)", "warn");
      } else if (reason === "manual") {
        void this.postStatus("Manual refresh complete", "ok");
      }

      if (reason !== "poll") {
        void this.refreshCliAuthStatus(["codex", "copilot"]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void this.postStatus(`Refresh failed: ${message}`, "err");
    }
  }

  private async refreshFromSupervisor(reason: RefreshReason): Promise<boolean> {
    return await refreshFromSupervisorHandler(this.supervisorFlowHandlersDeps(), reason);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private async waitForSupervisorSnapshotReady(baseUrl: string, authToken: string, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    let attempts = 0;
    while (Date.now() - startedAt < timeoutMs) {
      attempts += 1;
      if (await this.checkSupervisorSnapshot(baseUrl, authToken)) {
        if (attempts > 1) {
          this.logInfo(`Supervisor snapshot ready after ${attempts} checks (${Date.now() - startedAt}ms).`);
        }
        return;
      }
      await this.sleep(320);
    }
    this.logWarn(`Supervisor snapshot readiness check timed out after ${attempts} attempts (${timeoutMs}ms).`);
  }

  private async checkSupervisorSnapshot(baseUrl: string, authToken: string): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    try {
      const headers: Record<string, string> = {};
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }
      const response = await fetch(`${baseUrl}/snapshot`, {
        method: "GET",
        signal: controller.signal,
        headers
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private onStreamEnvelope(envelope: StreamEnvelope): void {
    if (!this.snapshot) {
      if (envelope.eventType === "snapshot") {
        const payload = this.withAgents(envelope.payload as DashboardSnapshot);
        this.acceptSnapshot({
          ...payload,
          meta: {
            ...payload.meta,
            source: "supervisor",
            streamConnected: true,
            stale: false,
            sequence: envelope.sequence
          }
        });
      }
      return;
    }

    const next = applyStreamEnvelope(this.snapshot, envelope);
    this.acceptSnapshot(next);
  }

  private acceptSnapshot(snapshot: DashboardSnapshot): void {
    this.snapshot = this.decorateSnapshot(this.withAgents(snapshot));
    this.lastUpdatedMs = Date.now();
    this.streamConnected = this.snapshot.meta.streamConnected;
    this.syncTerminalStreams();
    void this.postAuthState();
    void this.pushSnapshot();
  }

  private async pushSnapshot(): Promise<void> {
    if (!this.snapshot) {
      return;
    }

    await this.postMessageToAllWebviews("snapshot", this.snapshot);
  }

  private async postStatus(text: string, level: "ok" | "warn" | "err"): Promise<void> {
    if (level === "ok") {
      this.logInfo(text);
    } else if (level === "warn") {
      this.logWarn(text);
    } else {
      this.logError(text);
    }
    await this.postMessageToAllWebviews("status", { text, level });
  }

  private async postAuthState(): Promise<void> {
    const codex = this.resolveCliAuthStateForWebview("codex");
    const copilot = this.resolveCliAuthStateForWebview("copilot");
    const payload = {
      ok: this.ghAuthOk,
      codex,
      copilot
    };
    const payloadKey = JSON.stringify(payload);
    if (payloadKey === this.lastPostedAuthPayload) {
      return;
    }
    this.lastPostedAuthPayload = payloadKey;

    this.logInfo(
      `[auth] posting state gh=${this.ghAuthOk ? "ok" : "missing"} ` +
        `codex=${codex.state}/${codex.summary} ` +
        `copilot=${copilot.state}/${copilot.summary}`
    );
    await this.postMessageToAllWebviews("auth", payload);
  }

  private latestTerminalSessionForAuthService(
    service: CliAuthService
  ): DashboardSnapshot["agents"]["sessions"][number] | null {
    if (!this.snapshot) {
      return null;
    }

    const candidates = this.snapshot.agents.sessions
      .filter((session) => {
        if (!this.isTerminalEligibleSession(session)) {
          return false;
        }
        return String(session.service ?? "").trim().toLowerCase() === service;
      })
      .sort((left, right) => this.timestampMs(right.updatedAt) - this.timestampMs(left.updatedAt));

    return candidates[0] ?? null;
  }

  private resolveCliAuthStateForWebview(service: CliAuthService): CliAuthStatus {
    const base = this.cliAuthState[service];
    const terminalSession = this.latestTerminalSessionForAuthService(service);
    if (!terminalSession) {
      return base;
    }

    if (base.state === "signed-in" || base.state === "limited") {
      return {
        ...base,
        authenticated: true,
        available: true,
        checkedAt: new Date().toISOString()
      };
    }

    return {
      ...base,
      state: "signed-in",
      authenticated: true,
      available: true,
      limited: false,
      summary: "Terminal ready via Supervisor session.",
      detail: `Using active session ${terminalSession.sessionId}.`,
      checkedAt: new Date().toISOString()
    };
  }

  private async refreshCliAuthStatus(services: CliAuthService[]): Promise<void> {
    const settings = this.getRuntimeSettings();
    this.logInfo(`[auth] refresh start services=${services.join(",")}`);
    const results = await Promise.all(
      services.map(async (service) => {
        const cliPath = service === "codex" ? settings.codexCliPath : settings.copilotCliPath;
        try {
          const status = await probeCliAuthStatus(service, cliPath, (line) => {
            this.logInfo(`[auth:${service}] ${line}`);
          });
          this.logInfo(
            `[auth:${service}] refresh result state=${status.state} ` +
              `authenticated=${String(status.authenticated)} available=${String(status.available)} ` +
              `limited=${String(status.limited)} summary=${status.summary} detail=${status.detail}`
          );
          return { service, status };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logWarn(`[auth:${service}] refresh failed: ${message}`);
          return {
            service,
            status: {
              ...createUnknownCliAuthStatus(service),
              summary: "Status probe failed.",
              detail: message,
              checkedAt: new Date().toISOString()
            }
          };
        }
      })
    );

    let changed = false;
    for (const result of results) {
      const previous = this.cliAuthState[result.service];
      const next = result.status;
      if (
        previous.state !== next.state ||
        previous.summary !== next.summary ||
        previous.detail !== next.detail ||
        previous.authenticated !== next.authenticated ||
        previous.available !== next.available ||
        previous.limited !== next.limited
      ) {
        this.logInfo(
          `[auth:${result.service}] state change ${previous.state} -> ${next.state} ` +
            `(summary='${previous.summary}' -> '${next.summary}')`
        );
        this.cliAuthState[result.service] = next;
        changed = true;
      }
    }

    if (changed) {
      await this.postAuthState();
    }
  }

  private startupTerminalSessionId(service: StartupTerminalService): string {
    return `startup-${service}-terminal`;
  }

  private startupTerminalAgentId(service: StartupTerminalService): string {
    return `startup-${service}`;
  }

  private startupServiceLabel(service: StartupTerminalService): string {
    if (service === "codex") {
      return "Codex";
    }
    if (service === "copilot") {
      return "Copilot";
    }
    if (service === "claude") {
      return "Claude Code";
    }
    return "Gemini";
  }

  private startupServiceCliPath(service: StartupTerminalService, settings: ReturnType<DataService["getSettings"]>): string {
    if (service === "codex") {
      return settings.codexCliPath;
    }
    if (service === "copilot") {
      return settings.copilotCliPath;
    }
    if (service === "claude") {
      return settings.claudeCliPath;
    }
    return settings.geminiCliPath;
  }

  private startupServiceInstallCommand(
    service: StartupTerminalService,
    settings: ReturnType<DataService["getSettings"]>
  ): string {
    if (service === "codex") {
      return settings.codexCliInstallCommand;
    }
    if (service === "copilot") {
      return settings.copilotCliInstallCommand;
    }
    if (service === "claude") {
      return settings.claudeCliInstallCommand;
    }
    return settings.geminiCliInstallCommand;
  }

  private startupServiceSignInCommand(service: CliAuthService): string {
    return service === "codex" ? "codex login" : "copilot login";
  }

  private startupInstallAttemptStorageKey(service: StartupTerminalService): string {
    return `phoenixOps.startupCli.installAttemptAt.${service}`;
  }

  private startupSignInAttemptStorageKey(service: CliAuthService): string {
    return `phoenixOps.startupCli.signInAttemptAt.${service}`;
  }

  private startupAttemptWithinCooldown(storageKey: string, cooldownMs: number): boolean {
    const attemptedAt = this.context.globalState.get<number>(storageKey, 0);
    if (attemptedAt <= 0) {
      return false;
    }
    return Date.now() - attemptedAt < cooldownMs;
  }

  private async markStartupAttempt(storageKey: string): Promise<void> {
    await this.context.globalState.update(storageKey, Date.now());
  }

  private isCliCommandAvailable(configuredCommand: string, fallbackCommand: string): boolean {
    const invocation = parseCliInvocation(configuredCommand, fallbackCommand);
    const executable = invocation.command.trim();
    if (!executable) {
      return false;
    }

    if (executable.includes("\\") || executable.includes("/") || executable.includes(":")) {
      return fs.existsSync(executable);
    }

    const checker = process.platform === "win32" ? "where" : "which";
    try {
      const result = spawnSync(checker, [executable], { stdio: "ignore" });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  private launchCliInstallTerminal(service: StartupTerminalService, command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed) {
      return false;
    }

    const terminalName = `Phoenix Ops: Install ${this.startupServiceLabel(service)} CLI`;
    if (vscode.window.terminals.some((terminal) => terminal.name === terminalName)) {
      this.logInfo(`startup auto-install skipped for ${service}: install terminal already exists (${terminalName}).`);
      return false;
    }

    const terminal = vscode.window.createTerminal({
      name: terminalName
    });
    terminal.show(false);
    terminal.sendText(trimmed, true);
    return true;
  }

  private scheduleStartupCliBootstrap(): void {
    if (this.startupCliBootstrapTimer || this.startupCliBootstrapDone || this.startupCliBootstrapInFlight || this.disposed) {
      return;
    }

    this.startupCliBootstrapTimer = setTimeout(() => {
      this.startupCliBootstrapTimer = null;
      void this.bootstrapCliRuntimeOnStartup();
    }, STARTUP_CLI_BOOTSTRAP_DEFER_MS);
  }

  private async ensureStartupPtyTerminal(service: StartupTerminalService): Promise<void> {
    const sessionId = this.startupTerminalSessionId(service);
    const existingSession = this.snapshot?.agents.sessions.find((session) => session.sessionId === sessionId) ?? null;
    if (
      existingSession &&
      (existingSession.status === "online" || existingSession.status === "busy" || existingSession.status === "waiting")
    ) {
      return;
    }

    const workspaceContext = await resolveCurrentWorkspaceContextHandler();
    const workspace = workspaceContext?.workspace ?? defaultWorkspacePath();
    if (!workspace) {
      this.logWarn(`startup cli bootstrap skipped for ${service}: workspace path unavailable.`);
      return;
    }

    const repository = workspaceContext?.repoSlug ?? null;
    const branch = workspaceContext?.branch ?? null;
    const agentId = this.startupTerminalAgentId(service);

    await postSupervisorJsonHandler(this.agentRuntimeHandlersDeps(), "/agents/dispatch", {
      sessionId,
      agentId,
      transport: "local",
      summary: `Startup ${service} PTY terminal bootstrap`,
      service,
      mode: "agent",
      model: null,
      effort: null,
      toolProfile: "terminal",
      mcpTools: [],
      repository,
      branch,
      workspace,
      issueNumber: null,
      issueNodeId: null
    });
  }

  private async sendStartupTerminalCommand(service: StartupTerminalService, command: string): Promise<void> {
    const trimmed = command.trim();
    if (!trimmed) {
      return;
    }

    await postSupervisorJsonHandler(this.agentRuntimeHandlersDeps(), "/agents/terminal/input", {
      sessionId: this.startupTerminalSessionId(service),
      data: `${trimmed}\r`
    });
  }

  private async bootstrapCliRuntimeOnStartup(): Promise<void> {
    if (this.startupCliBootstrapDone || this.startupCliBootstrapInFlight || this.disposed) {
      return;
    }

    const settings = this.getRuntimeSettings();
    if (!settings.cliBootstrapOnStartup) {
      return;
    }

    this.startupCliBootstrapInFlight = true;
    try {
      if (settings.cliStartupAutoInstallMissing) {
        for (const service of STARTUP_TERMINAL_SERVICES) {
          const cliPath = this.startupServiceCliPath(service, settings);
          if (this.isCliCommandAvailable(cliPath, service)) {
            continue;
          }

          const installAttemptKey = this.startupInstallAttemptStorageKey(service);
          if (this.startupAttemptWithinCooldown(installAttemptKey, STARTUP_INSTALL_ATTEMPT_COOLDOWN_MS)) {
            this.logInfo(`startup auto-install skipped for ${service}: cooldown active.`);
            continue;
          }

          const installCommand = this.startupServiceInstallCommand(service, settings);
          if (!installCommand.trim()) {
            this.logWarn(`startup auto-install skipped for ${service}: no install command configured.`);
            continue;
          }

          const launched = this.launchCliInstallTerminal(service, installCommand);
          await this.markStartupAttempt(installAttemptKey);
          if (launched) {
            await this.postStatus(`${this.startupServiceLabel(service)} CLI not found. Started install command in terminal.`, "warn");
          }
        }
      }

      await this.refreshCliAuthStatus([...AUTH_TRACKED_STARTUP_SERVICES]);

      if (settings.cliStartupSpawnPtyTerminals) {
        for (const service of STARTUP_TERMINAL_SERVICES) {
          await this.ensureStartupPtyTerminal(service);
        }
      }

      for (const service of AUTH_TRACKED_STARTUP_SERVICES) {
        const status = this.resolveCliAuthStateForWebview(service);

        if (settings.cliStartupAutoSignIn && (status.state === "signed-out" || status.state === "unknown")) {
          const signInAttemptKey = this.startupSignInAttemptStorageKey(service);
          if (this.startupAttemptWithinCooldown(signInAttemptKey, STARTUP_SIGNIN_ATTEMPT_COOLDOWN_MS)) {
            this.logInfo(`startup sign-in skipped for ${service}: cooldown active.`);
            continue;
          }

          const startupSessionId = this.startupTerminalSessionId(service);
          if (!this.canSendTerminalInput(startupSessionId)) {
            this.logWarn(`startup sign-in skipped for ${service}: startup terminal session is not ready.`);
            continue;
          }

          const signInCommand = this.startupServiceSignInCommand(service);
          await this.sendStartupTerminalCommand(service, signInCommand);
          await this.markStartupAttempt(signInAttemptKey);
          await this.postStatus(`Startup sign-in command sent for ${service}.`, "warn");
        }
      }

      await this.refreshCliAuthStatus([...AUTH_TRACKED_STARTUP_SERVICES]);
      this.startupCliBootstrapDone = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logWarn(`startup cli bootstrap failed: ${message}`);
      await this.postStatus(`Startup CLI bootstrap failed: ${message}`, "warn");
    } finally {
      this.startupCliBootstrapInFlight = false;
    }
  }

  private async watchCliAuthAfterSignIn(service: CliAuthService): Promise<void> {
    this.logInfo(`[auth:${service}] watch start after sign-in trigger.`);
    const checkingState: CliAuthStatus = {
      ...this.cliAuthState[service],
      state: "checking",
      summary: "Checking sign-in status...",
      checkedAt: new Date().toISOString()
    };
    this.cliAuthState[service] = checkingState;
    await this.postAuthState();

    const existing = this.cliAuthWatchTimers.get(service);
    if (existing) {
      clearInterval(existing);
      this.cliAuthWatchTimers.delete(service);
    }

    let attempts = 0;
    let running = false;
    const maxAttempts = 45;
    const intervalMs = 4000;

    const tick = async () => {
      if (running || this.disposed) {
        return;
      }
      running = true;
      attempts += 1;
      try {
        this.logInfo(`[auth:${service}] watch tick attempt=${attempts}/${maxAttempts}`);
        await this.refreshCliAuthStatus([service]);
      } finally {
        running = false;
      }

      const status = this.cliAuthState[service];
      const done =
        status.state === "signed-in" ||
        status.state === "limited" ||
        status.state === "unavailable" ||
        attempts >= maxAttempts;
      if (done) {
        this.logInfo(
          `[auth:${service}] watch stopping state=${status.state} attempts=${attempts} summary=${status.summary}`
        );
        const timer = this.cliAuthWatchTimers.get(service);
        if (timer) {
          clearInterval(timer);
          this.cliAuthWatchTimers.delete(service);
        }
      }
    };

    await tick();

    if (this.disposed) {
      return;
    }

    const status = this.cliAuthState[service];
    if (
      status.state === "signed-in" ||
      status.state === "limited" ||
      status.state === "unavailable"
    ) {
      this.logInfo(`[auth:${service}] watch completed immediately with state=${status.state}.`);
      return;
    }

    const timer = setInterval(() => {
      void tick();
    }, intervalMs);
    this.cliAuthWatchTimers.set(service, timer);
  }

  private logInfo(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] [info] ${message}`);
  }

  private logWarn(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] [warn] ${message}`);
  }

  private logError(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] [error] ${message}`);
  }

  private async postMessageToAllWebviews(type: string, payload: unknown): Promise<void> {
    await this.boardViewProvider.postMessage(type, payload);
    await this.agentViewProvider.postMessage(type, payload);
    for (const panel of this.sessionPanels.values()) {
      await this.safePostToPanel(panel, type, payload);
    }
  }

  private async safePostToPanel(panel: vscode.WebviewPanel, type: string, payload: unknown): Promise<void> {
    try {
      await panel.webview.postMessage({ type, payload });
    } catch {
      // Ignore messages to disposed/racing panels.
    }
  }

  private async postContextResponse(
    sourceWebview: vscode.Webview | undefined,
    type: "contextAdded" | "contextError",
    payload: unknown
  ): Promise<void> {
    if (sourceWebview) {
      await sourceWebview.postMessage({ type, payload });
      return;
    }
    await this.postMessageToAllWebviews(type, payload);
  }

  private async postWebviewResponse(
    sourceWebview: vscode.Webview | undefined,
    type: string,
    payload: unknown
  ): Promise<void> {
    if (sourceWebview) {
      await sourceWebview.postMessage({ type, payload });
      return;
    }
    await this.postMessageToAllWebviews(type, payload);
  }

  private closeAllTerminalStreams(): void {
    for (const client of this.terminalClients.values()) {
      client.dispose();
    }
    this.terminalClients.clear();
  }

  private isTerminalEligibleSession(session: DashboardSnapshot["agents"]["sessions"][number]): boolean {
    const service = String(session.service ?? "").toLowerCase();
    if (service === "jarvis") {
      return false;
    }

    if (session.transport !== "local" && session.transport !== "cli") {
      return false;
    }

    return session.status === "online" || session.status === "busy" || session.status === "waiting";
  }

  private canSendTerminalInput(sessionId: string): boolean {
    if (!this.snapshot) {
      return false;
    }

    const session = this.snapshot.agents.sessions.find((candidate) => candidate.sessionId === sessionId) ?? null;
    if (!session || !this.isTerminalEligibleSession(session)) {
      return false;
    }

    return this.terminalClients.has(sessionId);
  }

  private syncTerminalStreams(): void {
    if (!this.snapshot) {
      this.closeAllTerminalStreams();
      return;
    }

    const activeSessionIds = new Set(
      this.snapshot.agents.sessions
        .filter((session) => this.isTerminalEligibleSession(session))
        .map((session) => session.sessionId)
    );

    for (const sessionId of this.terminalClients.keys()) {
      if (!activeSessionIds.has(sessionId)) {
        const client = this.terminalClients.get(sessionId);
        client?.dispose();
        this.terminalClients.delete(sessionId);
      }
    }

    const settings = this.getRuntimeSettings();
    for (const sessionId of activeSessionIds) {
      if (this.terminalClients.has(sessionId)) {
        continue;
      }

      const client = new SupervisorTerminalClient();
      this.terminalClients.set(sessionId, client);
      client.connect(
        settings.supervisorBaseUrl,
        settings.supervisorAuthToken,
        sessionId,
        (payload) => {
          this.handleTerminalStreamPayload(payload);
        },
        (error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logWarn(`terminal stream error session=${sessionId}: ${message}`);
        },
        () => {
          this.terminalClients.delete(sessionId);
          void this.postMessageToAllWebviews("agentTerminalState", {
            sessionId,
            state: "unavailable",
            occurredAt: new Date().toISOString()
          });
          if (!this.disposed) {
            setTimeout(() => {
              if (!this.disposed) {
                this.syncTerminalStreams();
              }
            }, 1200);
          }
        }
      );
    }
  }

  private handleTerminalStreamPayload(payload: AgentTerminalStreamPayload): void {
    if (!payload || typeof payload !== "object" || typeof payload.sessionId !== "string") {
      return;
    }

    if (payload.type === "terminal.chunk") {
      void this.postMessageToAllWebviews("agentTerminalChunk", payload);
      return;
    }

    if (payload.type === "terminal.state") {
      void this.postMessageToAllWebviews("agentTerminalState", payload);
    }
  }

  private async sendAgentTerminalInput(payload: AgentTerminalInputPayload): Promise<void> {
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
    if (!sessionId) {
      return;
    }

    if (!this.canSendTerminalInput(sessionId)) {
      return;
    }

    const data = typeof payload.data === "string" ? payload.data : "";
    const hasResize =
      typeof payload.cols === "number" && Number.isFinite(payload.cols) &&
      typeof payload.rows === "number" && Number.isFinite(payload.rows);
    if (!data && !hasResize) {
      return;
    }

    try {
      await postSupervisorJsonHandler(this.agentRuntimeHandlersDeps(), "/agents/terminal/input", {
        sessionId,
        data,
        cols: hasResize ? Math.max(20, Math.floor(payload.cols as number)) : null,
        rows: hasResize ? Math.max(8, Math.floor(payload.rows as number)) : null
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logWarn(`terminal input failed session=${sessionId}: ${message}`);
    }
  }

  private async fetchSnapshot(url: string, authToken = ""): Promise<DashboardSnapshot> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const headers: Record<string, string> = {};
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return this.withAgents((await response.json()) as DashboardSnapshot);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private withAgents(snapshot: DashboardSnapshot): DashboardSnapshot {
    const raw = snapshot as DashboardSnapshot & {
      actions?: {
        runs?: DashboardSnapshot["actions"]["runs"];
        jobs?: DashboardSnapshot["actions"]["jobs"];
        pullRequests?: DashboardSnapshot["actions"]["pullRequests"];
      };
      agents?: {
        sessions?: DashboardSnapshot["agents"]["sessions"];
        feed?: DashboardSnapshot["agents"]["feed"];
        pendingCommands?: DashboardSnapshot["agents"]["pendingCommands"];
      };
    };

    const runs = this.filterRunsToRecentWindow(raw.actions?.runs ?? []);
    const runKeys = new Set(runs.map((run) => `${run.repo}::${run.id}`));
    const jobs = (raw.actions?.jobs ?? []).filter((job) => runKeys.has(`${job.repo}::${job.runId}`));
    const feed = this.filterFeedToCurrentSession(raw.agents?.feed ?? []);

    return {
      ...snapshot,
      actions: {
        runs,
        jobs,
        pullRequests: raw.actions?.pullRequests ?? []
      },
      agents: {
        sessions: raw.agents?.sessions ?? [],
        feed,
        pendingCommands: raw.agents?.pendingCommands ?? []
      }
    };
  }

  private timestampMs(value: string | null | undefined): number {
    const parsed = Date.parse(value ?? "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private runTimestampMs(run: DashboardSnapshot["actions"]["runs"][number]): number {
    const updatedAtMs = this.timestampMs(run.updatedAt);
    if (updatedAtMs > 0) {
      return updatedAtMs;
    }
    return this.timestampMs(run.createdAt);
  }

  private filterRunsToRecentWindow(
    runs: DashboardSnapshot["actions"]["runs"]
  ): DashboardSnapshot["actions"]["runs"] {
    const nowMs = Date.now();
    const minTimestampMs = nowMs - ACTIONS_LOOKBACK_WINDOW_MS;
    return runs
      .filter((run) => {
        const atMs = this.runTimestampMs(run);
        return atMs >= minTimestampMs && atMs <= nowMs;
      })
      .sort((left, right) => this.runTimestampMs(right) - this.runTimestampMs(left));
  }

  private filterFeedToCurrentSession(
    feed: DashboardSnapshot["agents"]["feed"]
  ): DashboardSnapshot["agents"]["feed"] {
    return feed
      .filter((entry) => this.timestampMs(entry.occurredAt) >= this.vscodeSessionStartedAtMs)
      .slice(-200);
  }

  private decorateSnapshot(snapshot: DashboardSnapshot): DashboardSnapshot {
    const sessions = snapshot.agents.sessions.map((session) => ({
      ...session,
      pinned: this.pinnedSessionIds.has(session.sessionId),
      archived: this.archivedSessionIds.has(session.sessionId)
    }));

    const pendingCommands = [...snapshot.agents.pendingCommands].sort((a, b) => {
      const left = Date.parse(a.updatedAt) || 0;
      const right = Date.parse(b.updatedAt) || 0;
      return right - left;
    });

    return {
      ...snapshot,
      agents: {
        sessions,
        feed: snapshot.agents.feed,
        pendingCommands
      }
    };
  }

  private loadSessionPreferences(): void {
    const pinned = this.context.globalState.get<string[]>(PINNED_SESSION_STORAGE_KEY, []);
    const archived = this.context.globalState.get<string[]>(ARCHIVED_SESSION_STORAGE_KEY, []);
    this.pinnedSessionIds = new Set(pinned);
    this.archivedSessionIds = new Set(archived);
  }

  private async persistSessionPreferences(): Promise<void> {
    await this.context.globalState.update(PINNED_SESSION_STORAGE_KEY, [...this.pinnedSessionIds]);
    await this.context.globalState.update(ARCHIVED_SESSION_STORAGE_KEY, [...this.archivedSessionIds]);
  }

  private async setSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    if (!sessionId) {
      return;
    }

    if (pinned) {
      this.pinnedSessionIds.add(sessionId);
    } else {
      this.pinnedSessionIds.delete(sessionId);
    }
    await this.persistSessionPreferences();
    if (this.snapshot) {
      this.snapshot = this.decorateSnapshot(this.snapshot);
      await this.pushSnapshot();
    }
  }

  private async archiveSession(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    this.archivedSessionIds.add(sessionId);
    await this.persistSessionPreferences();
    if (this.snapshot) {
      this.snapshot = this.decorateSnapshot(this.snapshot);
      await this.pushSnapshot();
    }
  }

  private async restoreSession(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    this.archivedSessionIds.delete(sessionId);
    await this.persistSessionPreferences();
    if (this.snapshot) {
      this.snapshot = this.decorateSnapshot(this.snapshot);
      await this.pushSnapshot();
    }
  }

}
