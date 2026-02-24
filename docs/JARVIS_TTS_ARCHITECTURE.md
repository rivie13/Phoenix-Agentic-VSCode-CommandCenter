# Jarvis TTS Architecture: Gemini Primary + Pollinations Fallback

## Overview

**Goal**: Deliver emotionally-nuanced British audio for Jarvis callouts using Gemini 2.5 Flash Preview TTS for primary delivery, with Pollinations as a fallback when Gemini quota is exhausted.

**Key Design Decisions**:
- **Chat/Summaries**: Pollinations (OpenAI chat, fast, reliable)
- **TTS/Audio**: Gemini (voice consistency + emotional delivery across personalities)
- **Fallback**: If Gemini quota exhausted → proxy to Pollinations TTS
- **API Key Management**: VS Code settings (secure, per-user, not in git)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Jarvis Supervisor Call                      │
│              (EmbeddedJarvisPollinationsRuntime)                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │ Personality │
                    │   Detection │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼─────┐    ┌──────▼──────┐    ┌─────▼────┐
   │   Chat   │    │  Gemini     │    │ Fallback │
   │Generation│    │  TTS Call   │    │  Handler │
   └────┬─────┘    └──────┬──────┘    └─────▲────┘
        │                 │                 │
        │          ┌──────▼──────┐          │
        │          │ Gemini API  │          │
        │          │   Success?  │          │
        │          └──────┬──────┘          │
        │                 │                 │
   ┌────▼─────┐      ┌────┴────┐      ┌────┴─────┐
   │Pollinations     │  Audio  │      │ Quota or │
   │Chat API │      │   Base64│      │ Error    │
   │(text gen)       └─────────┘      │triggered │
   └─────────┘                        └────┬─────┘
                                           │
                                    ┌──────▼──────┐
                                    │ Pollinations│
                                    │    TTS API  │
                                    │  Fallback   │
                                    └─────────────┘
```

---

## Implementation Plan

### Phase 1: API Key Management (VS Code Settings)

#### 1.1 Define Settings Schema

**File**: `package.json` (in Command Center extension manifest)

```json
{
  "contributes": {
    "configuration": {
      "title": "Jarvis TTS Configuration",
      "properties": {
        "phoenix.jarvis.gemini.apiKey": {
          "type": "string",
          "description": "Google Gemini API key for TTS synthesis. Get from https://ai.google.dev/",
          "markdownDescription": "Google Gemini API key for TTS synthesis. [Get a free key here](https://ai.google.dev/)",
          "default": "",
          "scope": "window"
        },
        "phoenix.jarvis.gemini.model": {
          "type": "string",
          "description": "Gemini model name for TTS",
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
          "description": "Pollinations API key (for chat and fallback TTS)",
          "default": "",
          "scope": "window"
        },
        "phoenix.jarvis.ttsProvider": {
          "type": "string",
          "enum": ["gemini", "gemini-with-fallback", "pollinations"],
          "description": "TTS provider: gemini (primary), gemini-with-fallback (Pollinations fallback), or pollinations (legacy)",
          "default": "gemini-with-fallback",
          "scope": "window"
        },
        "phoenix.jarvis.ttsDebug": {
          "type": "boolean",
          "description": "Log TTS provider selection and fallback events",
          "default": false,
          "scope": "window"
        }
      }
    }
  }
}
```

#### 1.2 Secure Credential Storage

VS Code provides `SecretStorage` API for storing sensitive credentials. Create a utility:

**File**: `src/services/CredentialManager.ts`

```typescript
import * as vscode from 'vscode';

/**
 * Manages secure credential storage for Jarvis TTS providers.
 * Uses VS Code's built-in SecretStorage for encrypted credential persistence.
 */
export class JarvisCredentialManager {
  private static readonly SERVICE_ID = 'phoenix-jarvis-tts';
  
  constructor(private secretStorage: vscode.SecretStorage) {}

  // Gemini credentials
  async getGeminiApiKey(): Promise<string | null> {
    return this.secretStorage.get(`${JarvisCredentialManager.SERVICE_ID}:gemini-api-key`);
  }

  async setGeminiApiKey(key: string): Promise<void> {
    await this.secretStorage.store(`${JarvisCredentialManager.SERVICE_ID}:gemini-api-key`, key);
  }

  async deleteGeminiApiKey(): Promise<void> {
    await this.secretStorage.delete(`${JarvisCredentialManager.SERVICE_ID}:gemini-api-key`);
  }

  // Pollinations credentials
  async getPollinationsApiKey(): Promise<string | null> {
    return this.secretStorage.get(`${JarvisCredentialManager.SERVICE_ID}:pollinations-api-key`);
  }

  async setPollinationsApiKey(key: string): Promise<void> {
    await this.secretStorage.store(`${JarvisCredentialManager.SERVICE_ID}:pollinations-api-key`, key);
  }

  async deletePollinationsApiKey(): Promise<void> {
    await this.secretStorage.delete(`${JarvisCredentialManager.SERVICE_ID}:pollinations-api-key`);
  }
}
```

#### 1.3 Configuration Wrapper

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
    private config: vscode.WorkspaceConfiguration,
    private credentialManager: JarvisCredentialManager
  ) {}

  async getProviderConfig(): Promise<JarvisProviderConfig> {
    const provider = this.config.get<string>('phoenix.jarvis.ttsProvider') as any ?? 'gemini-with-fallback';
    const debug = this.config.get<boolean>('phoenix.jarvis.ttsDebug') ?? false;

    const result: JarvisProviderConfig = {
      provider,
      debug
    };

    // Load Gemini config if needed
    if (provider === 'gemini' || provider === 'gemini-with-fallback') {
      const apiKey = await this.credentialManager.getGeminiApiKey();
      if (!apiKey) {
        throw new Error(
          'Gemini API key not found. Run "Phoenix: Setup Jarvis TTS" to configure.'
        );
      }
      result.gemini = {
        apiKey,
        model: this.config.get<string>('phoenix.jarvis.gemini.model') ?? 'gemini-2.5-flash-preview-0001',
        voice: this.config.get<string>('phoenix.jarvis.gemini.voice') ?? 'en-GB-Neural2-C'
      };
    }

    // Load Pollinations config if needed (for chat or fallback)
    if (provider === 'gemini-with-fallback' || provider === 'pollinations') {
      const apiKey = await this.credentialManager.getPollinationsApiKey();
      if (!apiKey && provider === 'pollinations') {
        throw new Error(
          'Pollinations API key not found. Run "Phoenix: Setup Jarvis TTS" to configure.'
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

### Phase 2: TTS Provider Abstraction

#### 2.1 Define Provider Interface

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

#### 2.2 Gemini TTS Provider Implementation

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
    const styleInstructions = this.buildGeminiStyleInstructions(request.personality);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

    const payload = {
      contents: [{
        parts: [{
          text: `[STYLE INSTRUCTIONS]\n${styleInstructions}\n\n[TEXT TO SYNTHESIZE]\n${request.text}`
        }]
      }],
      generationConfig: {
        // Adjust if Gemini provides TTS-specific config
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      if (this.debug) {
        console.error(`[Gemini TTS] Error: ${response.status} ${response.statusText}`);
      }
      throw new Error(`Gemini TTS failed: ${response.status}`);
    }

    const result = await response.json();
    
    // Extract audio from Gemini response (format may vary—check docs)
    const audioBase64 = result.audio?.data ?? result.audioContent;
    if (!audioBase64) {
      throw new Error('No audio in Gemini response');
    }

    return {
      audioBase64,
      mimeType: 'audio/mpeg',
      provider: 'gemini'
    };
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
            contents: [{ parts: [{ text: 'ping' }] }]
          })
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildGeminiStyleInstructions(personality: string): string {
    const instructions = {
      serene: `Accent: British English (warm RP)
Tone: Warm, relaxed, and reassuring
Emotion: Contentment mixed with mild friendliness
Pace: Unhurried, leisurely
Warmth: Convey that everything is well in the world`,
      
      attentive: `Accent: British English (professional RP)
Tone: Measured, composed, businesslike
Emotion: Focused attention with hints of dry humor
Pace: Normal, professional, crisp
Clarity: Prioritize clear articulation`,
      
      alert: `Accent: British English (crisp, professional)
Tone: Slightly concerned, direct, purposeful
Emotion: Alertness with underlying responsibility
Pace: Slightly faster than normal
Emphasis: Subtle stress on action items`,
      
      escalating: `Accent: British English (sharp, commanding)
Tone: Serious, urgent, no-nonsense
Emotion: Genuine concern for the operator, responsibility
Pace: Controlled but fast
Emphasis: Stress critical information heavily`
    };

    return instructions[personality as keyof typeof instructions] || instructions.attentive;
  }
}
```

#### 2.3 Gemini with Pollinations Fallback

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
        console.log(`[Jarvis TTS] Attempting Gemini (personality: ${request.personality})`);
      }
      const result = await this.gemini.synthesize(request);
      return result;
    } catch (error) {
      if (this.debug) {
        console.warn(`[Jarvis TTS] Gemini failed, falling back to Pollinations:`, error);
      }
      // Fall back to Pollinations for TTS  (but keep Gemini success as a marker)
      const fallbackResult = await this.pollinationsFallback.synthesize(request);
      return {
        ...fallbackResult,
        fallbackUsed: true
      };
    }
  }

  async health(): Promise<boolean> {
    // Consider healthy if either provider is available
    const geminiOk = await this.gemini.health();
    const pollinationsOk = await this.pollinationsFallback.health();
    return geminiOk || pollinationsOk;
  }
}
```

#### 2.4 Pollinations TTS Provider (existing, refactored)

**File**: `src/services/tts/PollinationsTtsProvider.ts`

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
          content: `Text to synthesize with ${request.personality} tone: ${request.text}`
        }
      ]
    };

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
        console.error(`[Pollinations TTS] Error: ${response.status}`);
      }
      throw new Error(`Pollinations TTS failed: ${response.status}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    return {
      audioBase64,
      mimeType: 'audio/mpeg',
      provider: 'pollinations'
    };
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

### Phase 3: Chat via Pollinations (Unchanged Concept, Refactored)

Keep using Pollinations for generating British summaries (since Gemini TTS is now handling delivery):

**File**: `src/services/chat/PollinationsChatProvider.ts`

```typescript
export class PollinationsChatProvider {
  constructor(
    private apiKey: string,
    private debug: boolean = false
  ) {}

  async generateSummary(
    prompt: string,
    personality: 'serene' | 'attentive' | 'alert' | 'escalating'
  ): Promise<string> {
    // Call Pollinations openai endpoint for text generation
    // Use buildJarvisSystemPrompt() to inject personality
    // Return British summary text
  }
}
```

### Phase 4: Update EmbeddedJarvisPollinationsRuntime

**File**: `src/embeddedSupervisor/jarvisPollinations.ts`

Key changes:

1. **Inject TTS Provider**:
```typescript
constructor(
  private readonly config: EmbeddedJarvisPollinationsConfig,
  private readonly ttsProvider: JarvisTtsProvider  // NEW
) {}
```

2. **Update synthesizeSpeech()**:
```typescript
private async synthesizeSpeech(
  text: string,
  personality: JarvisPersonalityMode
): Promise<{ audioBase64: string; mimeType: string }> {
  const result = await this.ttsProvider.synthesize({
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

3. **Keep chat via Pollinations** (unchanged):
```typescript
// Chat still uses Pollinations for British text generation
const chatResponse = await this.fetchSummaryText(...);
```

### Phase 5: Extension Setup Commands

**File**: `src/controller/jarvisSetupCommands.ts`

```typescript
export class JarvisSetupCommands {
  static registerCommands(
    context: vscode.ExtensionContext,
    configManager: JarvisConfigManager,
    credentialManager: JarvisCredentialManager
  ) {
    context.subscriptions.push(
      vscode.commands.registerCommand('phoenix.jarvis.setup', async () => {
        const action = await vscode.window.showQuickPick(
          [
            { label: 'Configure Gemini API Key', value: 'gemini' },
            { label: 'Configure Pollinations API Key', value: 'pollinations' },
            { label: 'View Current Config', value: 'view' },
            { label: 'Test TTS Providers', value: 'test' }
          ],
          { placeHolder: 'Select Jarvis TTS setup action' }
        );

        if (action?.value === 'gemini') {
          const key = await vscode.window.showInputBox({
            prompt: 'Paste your Google Gemini API key',
            password: true,
            ignoreFocusOut: true
          });
          if (key) {
            await credentialManager.setGeminiApiKey(key);
            vscode.window.showInformationMessage('Gemini API key saved securely');
          }
        }

        if (action?.value === 'pollinations') {
          const key = await vscode.window.showInputBox({
            prompt: 'Paste your Pollinations API key',
            password: true,
            ignoreFocusOut: true
          });
          if (key) {
            await credentialManager.setPollinationsApiKey(key);
            vscode.window.showInformationMessage('Pollinations API key saved securely');
          }
        }

        // ... etc for other actions
      })
    );
  }
}
```

---

## Configuration Flow

```
User opens Command Center
    ↓
Extension activates, attempts to load JarvisProviderConfig
    ↓
Is Gemini API key stored? 
    ├─ NO  → Prompt: "Run 'Phoenix: Setup Jarvis TTS'" 
    ├─ YES → Load config
    ↓
Is Pollinations key stored (for fallback)?
    ├─ OPTIONAL if only using Gemini
    ├─ REQUIRED if using gemini-with-fallback
    ↓
Initialize TTS provider (Gemini / Gemini+Fallback / Pollinations)
    ↓
Ready for Jarvis callouts
```

---

## Security Considerations

1. **Never store API keys in**:
   - `settings.json` (user or workspace)
   - `.env` files
   - Git-tracked configuration
   - Logs or debug output

2. **Always use**:
   - VS Code's `SecretStorage` API (encrypted by OS credential manager)
   - `password: true` in `showInputBox()` (masks input)
   - Conditional API key logging (only if `phoenix.jarvis.ttsDebug` AND debug mode)

3. **Rotation**:
   - Users can re-run setup command to update keys
   - Old keys are overwritten in secure storage
   - No rotation needed at system level

---

## Testing Strategy

### Test 1: Configuration Loading
- [ ] Can store Gemini API key securely
- [ ] Can store Pollinations API key securely
- [ ] Clearing a key removes it from storage
- [ ] Config manager throws helpful error if key missing

### Test 2: TTS Providers
- [ ] Gemini provider can synthesize with all 4 personalities
- [ ] Gemini voice remains consistent across personalities
- [ ] Pollinations fallback activates on Gemini error
- [ ] Fallback response includes `fallbackUsed: true`

### Test 3: Integration
- [ ] EmbeddedJarvisRuntime uses correct provider based on config
- [ ] Audio plays correctly from synthesis result
- [ ] Debug logging shows provider selection when enabled

### Test 4: Fallback Behavior
- [ ] Simulate Gemini quota exhaustion (401 or rate limit)
- [ ] Confirm fallback to Pollinations succeeds
- [ ] Confirm no broken audio or doubled processing

---

## Open Questions / TODOs

- [ ] Confirm exact Gemini API endpoint for TTS (may not be `/generateContent` for audio)
- [ ] Verify Gemini response format for audio output (`audio.data` vs `audioContent` vs other)
- [ ] Test Gemini voice names (`en-GB-Neural2-C` correct? Others available?)
- [ ] Decide: Should Pollinations be used for both chat AND fallback TTS, or separate?
- [ ] Performance: Measure latency of each provider for real-time callouts
- [ ] Rate limiting: How much quota do I get per month with free Gemini tier?

---

## Implementation Checklist

### Before Coding
- [ ] Read full Gemini TTS API docs
- [ ] Confirm Gemini endpoint & response format
- [ ] Test Gemini API with manual request in AI Studio
- [ ] Collect Gemini voice options available

### Phase 1: Settings & Credentials
- [ ] Update `package.json` with configuration schema
- [ ] Implement `CredentialManager.ts`
- [ ] Implement `jarvisConfig.ts`
- [ ] Test credential storage & retrieval

### Phase 2: TTS Providers
- [ ] Create provider interfaces
- [ ] Implement `GeminiTtsProvider.ts`
- [ ] Implement `PollinationsTtsProvider.ts` (refactor from Pollinations)
- [ ] Implement `GeminiWithFallbackProvider.ts`
- [ ] Unit test each provider

### Phase 3: Integration
- [ ] Update `jarvisPollinations.ts` to inject provider
- [ ] Wire personality to TTS style instructions
- [ ] Keep chat via Pollinations (no change to text generation)
- [ ] Test end-to-end with supervisor

### Phase 4: UX  
- [ ] Implement setup commands
- [ ] Add status bar indicator (Gemini vs Fallback)
- [ ] Error handling for missing keys
- [ ] Debug logging with `ttsDebug` setting

### Phase 5: Documentation
- [ ] User guide: How to get Gemini API key
- [ ] User guide: How to run setup command
- [ ] Troubleshooting: What to do if Gemini fails
- [ ] Architecture doc (this one, updated)

---

## Rollout Plan

**Phase A (Week 1)**: Implement & test locally
**Phase B (Week 2)**: Beta with known users (who have API keys)
**Phase C (Week 3)**: GA release with setup ceremony and docs

---
