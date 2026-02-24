# Jarvis Gemini TTS Implementation Guide

Step-by-step developer guide for wiring Gemini TTS (primary) + Pollinations fallback into Command Center.

## Current Runtime Notes (Implemented)

- Startup greeting now uses extension-local snapshot facts (current Command Center context) rather than supervisor `/jarvis/respond` generation.
- Jarvis session memory is persisted per VS Code session in extension global storage (`phoenix-jarvis-session-memory.json`).
- Cross-session carryover is bounded to a small summary window (last few sessions) to keep Jarvis meta-memory lightweight and ephemeral.

---

## Prerequisites

Before starting:

- ✅ Verify Gemini API endpoint and response format (see Gemini docs)
- ✅ Confirm Gemini TTS models and voices available
- ✅ Test manually in AI Studio with your key
- ✅ Have sample audio from Gemini TTS test

---

## Step 1: Update package.json Configuration Schema

**File**: `package.json`

Add configuration properties to VS Code extension manifest:

```json
{
  "contributes": {
    "configuration": [
      {
        "title": "Jarvis TTS Configuration",
        "properties": {
          "phoenix.jarvis.gemini.apiKey": {
            "type": "string",
            "description": "Google Gemini API key for TTS synthesis (get from https://ai.google.dev/)",
            "markdownDescription": "Google Gemini API key for TTS. [Get a free key](https://ai.google.dev/)",
            "default": "",
            "scope": "window"
          },
          "phoenix.jarvis.gemini.model": {
            "type": "string",
            "description": "Gemini model to use for TTS",
            "default": "gemini-2.5-flash-preview-0001",
            "scope": "window"
          },
          "phoenix.jarvis.gemini.voice": {
            "type": "string",
            "enum": ["en-GB-Neural2-C", "en-GB-Neural2-D", "en-GB-Standard-A"],
            "description": "British voice for Gemini TTS",
            "default": "en-GB-Neural2-C",
            "scope": "window"
          },
          "phoenix.jarvis.pollinations.apiKey": {
            "type": "string",
            "description": "Pollinations API key (for fallback TTS and chat)",
            "default": "",
            "scope": "window"
          },
          "phoenix.jarvis.ttsProvider": {
            "type": "string",
            "enum": ["gemini", "gemini-with-fallback", "pollinations"],
            "description": "Primary TTS provider selection",
            "default": "gemini-with-fallback",
            "scope": "window"
          },
          "phoenix.jarvis.ttsDebug": {
            "type": "boolean",
            "description": "Enable debug logging for TTS provider events",
            "default": false,
            "scope": "window"
          }
        }
      }
    ],
    "commands": [
      {
        "command": "phoenix.jarvis.setup",
        "title": "Phoenix: Setup Jarvis TTS",
        "description": "Configure API keys and TTS provider settings"
      }
    ]
  }
}
```

---

## Step 2: Create Credential Manager

**File**: `src/services/CredentialManager.ts`

```typescript
import * as vscode from 'vscode';

export class JarvisCredentialManager {
  private static readonly SERVICE_ID = 'phoenix-jarvis-tts';

  constructor(private secretStorage: vscode.SecretStorage) {}

  async getGeminiApiKey(): Promise<string | null> {
    return this.secretStorage.get(`${JarvisCredentialManager.SERVICE_ID}:gemini-api-key`);
  }

  async setGeminiApiKey(key: string): Promise<void> {
    await this.secretStorage.store(`${JarvisCredentialManager.SERVICE_ID}:gemini-api-key`, key);
  }

  async deleteGeminiApiKey(): Promise<void> {
    await this.secretStorage.delete(`${JarvisCredentialManager.SERVICE_ID}:gemini-api-key`);
  }

  async getPollinationsApiKey(): Promise<string | null> {
    return this.secretStorage.get(`${JarvisCredentialManager.SERVICE_ID}:pollinations-api-key`);
  }

  async setPollinationsApiKey(key: string): Promise<void> {
    await this.secretStorage.store(
      `${JarvisCredentialManager.SERVICE_ID}:pollinations-api-key`,
      key
    );
  }

  async deletePollinationsApiKey(): Promise<void> {
    await this.secretStorage.delete(`${JarvisCredentialManager.SERVICE_ID}:pollinations-api-key`);
  }
}
```

---

## Step 3: Create Configuration Manager

**File**: `src/utils/jarvisConfig.ts`

```typescript
import * as vscode from 'vscode';
import { JarvisCredentialManager } from '../services/CredentialManager';

export interface JarvisProviderConfig {
  provider: 'gemini' | 'gemini-with-fallback' | 'pollinations';
  gemini?: {
    apiKey: string;
    model: string;
    voice: string;
  };
  pollinations?: {
    apiKey: string;
  };
  debug: boolean;
}

export class JarvisConfigManager {
  constructor(
    private credentialManager: JarvisCredentialManager
  ) {}

  async getProviderConfig(): Promise<JarvisProviderConfig> {
    const config = vscode.workspace.getConfiguration();
    const provider = config.get<string>('phoenix.jarvis.ttsProvider') ?? 'gemini-with-fallback';
    const debug = config.get<boolean>('phoenix.jarvis.ttsDebug') ?? false;

    const result: JarvisProviderConfig = {
      provider: provider as any,
      debug
    };

    // Load Gemini config if needed
    if (provider === 'gemini' || provider === 'gemini-with-fallback') {
      const apiKey = await this.credentialManager.getGeminiApiKey();
      if (!apiKey) {
        throw new Error(
          'Gemini API key not configured. Run "Phoenix: Setup Jarvis TTS" » Configure Gemini API Key'
        );
      }
      result.gemini = {
        apiKey,
        model: config.get<string>('phoenix.jarvis.gemini.model') ?? 'gemini-2.5-flash-preview-0001',
        voice: config.get<string>('phoenix.jarvis.gemini.voice') ?? 'en-GB-Neural2-C'
      };
    }

    // Load Pollinations if needed (for fallback or as primary)
    if (provider === 'gemini-with-fallback' || provider === 'pollinations') {
      const apiKey = await this.credentialManager.getPollinationsApiKey();
      if (!apiKey && provider === 'pollinations') {
        throw new Error(
          'Pollinations API key not configured. Run "Phoenix: Setup Jarvis TTS" » Configure Pollinations API Key'
        );
      }
      result.pollinations = {
        apiKey: apiKey ?? ''
      };
    }

    return result;
  }
}
```

---

## Step 4: Create TTS Provider Interface

**File**: `src/services/tts/JarvisTtsProvider.ts`

```typescript
export interface TtsRequest {
  text: string;
  personality: 'serene' | 'attentive' | 'alert' | 'escalating';
  voiceOverride?: string;
}

export interface TtsResponse {
  audioBase64: string;
  mimeType: string;
  provider: 'gemini' | 'pollinations';
  fallbackUsed?: boolean;
}

export interface JarvisTtsProvider {
  synthesize(request: TtsRequest): Promise<TtsResponse>;
  health(): Promise<boolean>;
  name: string;
}
```

---

## Step 5: Implement Gemini TTS Provider

**File**: `src/services/tts/GeminiTtsProvider.ts`

```typescript
import { JarvisTtsProvider, TtsRequest, TtsResponse } from './JarvisTtsProvider';

export class GeminiTtsProvider implements JarvisTtsProvider {
  name = 'gemini';

  constructor(
    private apiKey: string,
    private model: string,
    private voice: string,
    private debug: boolean = false
  ) {}

  async synthesize(request: TtsRequest): Promise<TtsResponse> {
    const styleInstructions = this.buildStyleInstructions(request.personality);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

    const systemMessage = `You are Jarvis, a British AI assistant. Synthesize the following text with these delivery instructions:

STYLE INSTRUCTIONS:
${styleInstructions}

TEXT TO SYNTHESIZE:
${request.text}`;

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: systemMessage
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096
      }
    };

    if (this.debug) {
      console.log(`[Jarvis TTS] Gemini request - personality: ${request.personality}`);
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.text();
        if (this.debug) {
          console.error(`[Jarvis TTS] Gemini error ${response.status}:`, error);
        }
        throw new Error(`Gemini TTS failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      // Extract audio from Gemini response
      // NOTE: Adjust based on actual Gemini TTS response format
      let audioBase64: string | undefined;

      if (result.candidates?.[0]?.content?.parts?.[0]?.inline_data?.data) {
        audioBase64 = result.candidates[0].content.parts[0].inline_data.data;
      } else if (result.audio?.data) {
        audioBase64 = result.audio.data;
      } else if (result.audioContent) {
        audioBase64 = result.audioContent;
      }

      if (!audioBase64) {
        throw new Error(
          `No audio in Gemini response. Got: ${JSON.stringify(result).substring(0, 200)}`
        );
      }

      if (this.debug) {
        console.log('[Jarvis TTS] Gemini synthesis complete');
      }

      return {
        audioBase64,
        mimeType: 'audio/mpeg',
        provider: 'gemini'
      };
    } catch (error) {
      if (this.debug) {
        console.error('[Jarvis TTS] Gemini synthesis failed:', error);
      }
      throw error;
    }
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: 'ping' }]
              }
            ]
          })
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildStyleInstructions(personality: string): string {
    const styles: Record<string, string> = {
      serene: `Accent: British English (warm RP)
Tone: Warm, relaxed, and reassuring
Emotion: Contentment mixed with mild friendliness
Pace: Unhurried, leisurely
Warmth: Convey that everything is well in the world
Attitude: Like a trusted butler ensuring all is calm`,

      attentive: `Accent: British English (professional RP)
Tone: Measured, composed, businesslike
Emotion: Focused attention with hints of dry humor
Pace: Normal, professional, crisp
Clarity: Prioritize clear articulation for tactical information
Attitude: Like a competent professional briefing a colleague`,

      alert: `Accent: British English (crisp, professional)
Tone: Slightly concerned, direct, purposeful
Emotion: Alertness with underlying responsibility
Pace: Slightly faster than normal
Emphasis: Subtle stress on important items
Attitude: Like a reliable advisor noting that attention is genuinely needed`,

      escalating: `Accent: British English (sharp, commanding)
Tone: Serious, urgent, no-nonsense
Emotion: Genuine concern for the operator, responsibility
Pace: Controlled but fast, emphasizing importance
Emphasis: Stress critical information heavily
Attitude: Like a seasoned commander reporting a situation demanding immediate action`
    };

    return styles[personality] || styles.attentive;
  }
}
```

---

## Step 6: Implement Pollinations TTS Provider (Refactored)

**File**: `src/services/tts/PollinationsTtsProvider.ts`

Refactor existing Pollinations logic into provider interface:

```typescript
import { JarvisTtsProvider, TtsRequest, TtsResponse } from './JarvisTtsProvider';

export class PollinationsTtsProvider implements JarvisTtsProvider {
  name = 'pollinations';

  constructor(
    private apiKey: string,
    private voice: string = 'nova',
    private debug: boolean = false
  ) {}

  async synthesize(request: TtsRequest): Promise<TtsResponse> {
    const endpoint = 'https://text.pollinations.ai/openai';

    const payload = {
      model: 'openai-audio',
      messages: [
        {
          role: 'user',
          content: `Synthesize this text with ${request.personality} tone:\n\n${request.text}`
        }
      ]
    };

    if (this.debug) {
      console.log(`[Jarvis TTS] Pollinations request - personality: ${request.personality}`);
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        if (this.debug) {
          console.error(`[Jarvis TTS] Pollinations error ${response.status}`);
        }
        throw new Error(`Pollinations TTS failed: ${response.status}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const audioBase64 = Buffer.from(audioBuffer).toString('base64');

      if (this.debug) {
        console.log('[Jarvis TTS] Pollinations synthesis complete');
      }

      return {
        audioBase64,
        mimeType: 'audio/mpeg',
        provider: 'pollinations'
      };
    } catch (error) {
      if (this.debug) {
        console.error('[Jarvis TTS] Pollinations synthesis failed:', error);
      }
      throw error;
    }
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch('https://text.pollinations.ai/models', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

---

## Step 7: Implement Fallback Provider

**File**: `src/services/tts/GeminiWithFallbackProvider.ts`

```typescript
import { JarvisTtsProvider, TtsRequest, TtsResponse } from './JarvisTtsProvider';
import { GeminiTtsProvider } from './GeminiTtsProvider';
import { PollinationsTtsProvider } from './PollinationsTtsProvider';

export class GeminiWithFallbackProvider implements JarvisTtsProvider {
  name = 'gemini-with-fallback';

  constructor(
    private gemini: GeminiTtsProvider,
    private pollinationsFallback: PollinationsTtsProvider,
    private debug: boolean = false
  ) {}

  async synthesize(request: TtsRequest): Promise<TtsResponse> {
    try {
      if (this.debug) {
        console.log(`[Jarvis TTS] Attempting Gemini (${request.personality})`);
      }
      return await this.gemini.synthesize(request);
    } catch (error) {
      if (this.debug) {
        console.warn(`[Jarvis TTS] Gemini failed, falling back to Pollinations:`, error);
      }

      const fallbackResult = await this.pollinationsFallback.synthesize(request);
      return {
        ...fallbackResult,
        fallbackUsed: true
      };
    }
  }

  async health(): Promise<boolean> {
    const geminiOk = await this.gemini.health();
    const pollinationsOk = await this.pollinationsFallback.health();
    return geminiOk || pollinationsOk;
  }
}
```

---

## Step 8: Update Jarvis Pollinations Runtime

**File**: `src/embeddedSupervisor/jarvisPollinations.ts`

Key changes to inject TTS provider:

### 8.1 Update Config Interface

```typescript
export interface EmbeddedJarvisPollinationsConfig {
  // ... existing fields ...
  ttsProvider: JarvisTtsProvider; // NEW
}
```

### 8.2 Update Constructor

```typescript
export class EmbeddedJarvisPollinationsRuntime {
  constructor(private readonly config: EmbeddedJarvisPollinationsConfig) {}
}
```

### 8.3 Simplify synthesizeSpeech

```typescript
private async synthesizeSpeech(
  text: string,
  personality: 'serene' | 'attentive' | 'alert' | 'escalating'
): Promise<{ audioBase64: string; mimeType: string }> {
  const result = await this.config.ttsProvider.synthesize({
    text,
    personality,
    voiceOverride: this.config.voice
  });

  return {
    audioBase64: result.audioBase64,
    mimeType: result.mimeType
  };
}
```

### 8.4 Remove old synthesizeSpeech/fetchSpeechAudio methods

Delete the old methods that directly called Pollinations TTS. The provider abstraction handles it now.

### 8.5 Update imports

```typescript
import { buildJarvisSystemPrompt } from "../utils/jarvisPrompts";
import type { JarvisTtsProvider } from "../services/tts/JarvisTtsProvider";
```

---

## Step 9: Create Setup Command Handler

**File**: `src/commands/JarvisSetupCommand.ts`

```typescript
import * as vscode from 'vscode';
import { JarvisCredentialManager } from '../services/CredentialManager';
import { JarvisConfigManager } from '../utils/jarvisConfig';

export class JarvisSetupCommand {
  constructor(
    private credentialManager: JarvisCredentialManager,
    private configManager: JarvisConfigManager
  ) {}

  async show(): Promise<void> {
    const action = await vscode.window.showQuickPick(
      [
        { label: 'Configure Gemini API Key', value: 'gemini' },
        { label: 'Configure Pollinations API Key', value: 'pollinations' },
        { label: 'View Current Config', value: 'view' },
        { label: 'Test TTS Providers', value: 'test' }
      ],
      { placeHolder: 'Select Jarvis TTS setup action' }
    );

    if (!action) return;

    switch (action.value) {
      case 'gemini':
        await this.configureGemini();
        break;
      case 'pollinations':
        await this.configurePollinations();
        break;
      case 'view':
        await this.viewConfig();
        break;
      case 'test':
        await this.testProviders();
        break;
    }
  }

  private async configureGemini(): Promise<void> {
    const key = await vscode.window.showInputBox({
      prompt: 'Paste your Google Gemini API key',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'sk_...'
    });

    if (key) {
      await this.credentialManager.setGeminiApiKey(key);
      vscode.window.showInformationMessage(
        '✓ Gemini API key saved securely in VS Code'
      );
    }
  }

  private async configurePollinations(): Promise<void> {
    const key = await vscode.window.showInputBox({
      prompt: 'Paste your Pollinations API key (optional, for fallback)',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'pollen_...'
    });

    if (key) {
      await this.credentialManager.setPollinationsApiKey(key);
      vscode.window.showInformationMessage(
        '✓ Pollinations API key saved securely in VS Code'
      );
    }
  }

  private async viewConfig(): Promise<void> {
    try {
      const config = await this.configManager.getProviderConfig();
      const display = `
Current Jarvis TTS Configuration:

Provider: ${config.provider}
Debug: ${config.debug ? 'Enabled' : 'Disabled'}

${config.gemini ? `Gemini:
  Model: ${config.gemini.model}
  Voice: ${config.gemini.voice}
  API Key: ${config.gemini.apiKey ? '✓ Configured' : '✗ Missing'}` : ''}

${config.pollinations ? `Pollinations:
  API Key: ${config.pollinations.apiKey ? '✓ Configured' : '✗ Missing'}` : ''}
`;
      vscode.window.showInformationMessage(display, { modal: true });
    } catch (error) {
      vscode.window.showErrorMessage(`Config error: ${error}`);
    }
  }

  private async testProviders(): Promise<void> {
    vscode.window.showInformationMessage('Testing TTS providers... (feature TBD)');
    // TODO: Implement TTS test audio playback
  }
}
```

---

## Step 10: Register Commands in Extension

**File**: `src/extension.ts` (main extension entry point)

```typescript
import * as vscode from 'vscode';
import { JarvisCredentialManager } from './services/CredentialManager';
import { JarvisConfigManager } from './utils/jarvisConfig';
import { JarvisSetupCommand } from './commands/JarvisSetupCommand';

export async function activate(context: vscode.ExtensionContext) {
  const credentialManager = new JarvisCredentialManager(context.secrets);
  const configManager = new JarvisConfigManager(credentialManager);
  const setupCommand = new JarvisSetupCommand(credentialManager, configManager);

  context.subscriptions.push(
    vscode.commands.registerCommand('phoenix.jarvis.setup', () =>
      setupCommand.show()
    )
  );

  console.log('Jarvis TTS setup commands registered');
}

export function deactivate() {}
```

---

## Step 11: Wire TTS Provider into Supervisor Manager

**File**: `src/services/EmbeddedSupervisorManager.ts` (or wherever runtime is instantiated)

```typescript
import { JarvisConfigManager } from '../utils/jarvisConfig';
import { GeminiTtsProvider } from './tts/GeminiTtsProvider';
import { PollinationsTtsProvider } from './tts/PollinationsTtsProvider';
import { GeminiWithFallbackProvider } from './tts/GeminiWithFallbackProvider';
import type { JarvisTtsProvider } from './tts/JarvisTtsProvider';

async function createTtsProvider(
  configManager: JarvisConfigManager
): Promise<JarvisTtsProvider> {
  const config = await configManager.getProviderConfig();

  switch (config.provider) {
    case 'gemini':
      return new GeminiTtsProvider(
        config.gemini!.apiKey,
        config.gemini!.model,
        config.gemini!.voice,
        config.debug
      );

    case 'gemini-with-fallback':
      const gemini = new GeminiTtsProvider(
        config.gemini!.apiKey,
        config.gemini!.model,
        config.gemini!.voice,
        config.debug
      );
      const fallback = new PollinationsTtsProvider(
        config.pollinations?.apiKey ?? '',
        'nova',
        config.debug
      );
      return new GeminiWithFallbackProvider(gemini, fallback, config.debug);

    case 'pollinations':
      return new PollinationsTtsProvider(
        config.pollinations!.apiKey,
        'nova',
        config.debug
      );

    default:
      throw new Error(`Unknown TTS provider: ${config.provider}`);
  }
}

// When creating EmbeddedJarvisPollinationsRuntime:
const ttsProvider = await createTtsProvider(configManager);
const runtime = new EmbeddedJarvisPollinationsRuntime({
  // ... other config ...
  ttsProvider
});
```

---

## Step 12: Testing

### Unit Tests

Create `src/services/tts/__tests__/` folder:

- `GeminiTtsProvider.test.ts` → Mock Gemini API, test synthesis
- `PollinationsTtsProvider.test.ts` → Mock Pollinations API
- `GeminiWithFallbackProvider.test.ts` → Test fallback triggering

### Integration Tests

- Test credential storage and retrieval
- Test config loading with real VS Code settings
- Test end-to-end with EmbeddedJarvisRuntime

### Manual Testing

1. Run setup command, configure Gemini key
2. Trigger Jarvis callout in supervisor
3. Verify audio plays
4. Check debug log shows `Using: Gemini`
5. Simulate Gemini error (throttle API)
6. Verify fallback activates

---

## Step 13: Build and Package

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run linter
npm run lint

# Run tests
npm run test

# Package VSIX (optional, for distribution)
npm run package:vsix
```

---

## Validation Checklist

- [ ] Settings schema added to `package.json`
- [ ] `CredentialManager` stores/retrieves keys securely
- [ ] `JarvisConfigManager` loads config correctly
- [ ] `GeminiTtsProvider` can synthesize audio with styles
- [ ] `PollinationsTtsProvider` refactored and working
- [ ] `GeminiWithFallbackProvider` fallback triggers on error
- [ ] `EmbeddedJarvisRuntime` uses provider injection
- [ ] Setup command registered and callable
- [ ] Supervisor can instantiate with TTS provider
- [ ] Audio plays correctly from synthesis result
- [ ] Debug logging shows provider selection
- [ ] Fallback logs when Gemini fails

---

## Common Issues & Fixes

**Issue**: "Gemini API key not configured"
- **Fix**: Run setup command, paste key correctly

**Issue**: Gemini endpoint returns error
- **Fix**: Verify endpoint URL and payload format; check Gemini docs

**Issue**: Audio doesn't play
- **Fix**: Check `audioBase64` is valid; verify MIME type is `audio/mpeg`

**Issue**: Voice changes between personalities
- **Fix**: Gemini is changing voices; check voice parameter consistency

**Issue**: Fallback never triggers
- **Fix**: Check Gemini health() method; verify rate limiting works

---

## Next Checkpoint

Once implementation complete:

1. ✅ Test with real Gemini and Pollinations keys
2. ✅ Measure latency of each provider
3. ✅ Verify voice consistency across emotions
4. ✅ Demo with supervisor running
5. ✅ Gather user feedback pre-release

---
