# Jarvis TTS Setup Guide

How to set up Jarvis voice with Gemini TTS (primary) and Pollinations fallback.

---

## Table of Contents

1. [Get Gemini API Key](#get-gemini-api-key)
2. [Get Pollinations API Key (Optional)](#get-pollinations-api-key-optional)
3. [Configure in Command Center](#configure-in-command-center)
4. [Test Your Setup](#test-your-setup)
5. [Troubleshooting](#troubleshooting)

---

## Get Gemini API Key

Google Gemini offers a free tier with generous limits—perfect for testing and personal use.

### Quick Start

1. **Visit** [Google AI Studio](https://aistudio.google.com/)
2. **Sign in** with your Google account
3. **Click** "Create API Key" in the left sidebar
4. **Copy** the key (keep it private)
5. **Paste** into Command Center setup (next section)

### Free Tier Limits

- **Text requests**: 15 requests per minute (RPM)
- **Tokens**: 1M tokens/min (generous for summaries)
- **Cost**: $0 (truly free, no credit card required for free tier)

### If You Need More

Free tier runs out around 1000 requests/month for a typical setup. At that point, Pollinations fallback kicks in automatically.

If you need sustained usage:
- Upgrade at [Google Cloud Console](https://console.cloud.google.com/)
- Enable billing (pay-as-you-go, ~$0.04 per hour of TTS usage)
- Limits increase to 100+ RPM

---

## Get Pollinations API Key (Optional)

Pollinations is the fallback provider. You only need this if:
- Gemini quota is exhausted, OR
- You want Pollinations as primary TTS

### Get Free Key

1. **Visit** [Pollinations.ai Auth](https://auth.pollinations.ai/)
2. **Sign up** (free, no credit card)
3. **View API Token** in your dashboard
4. **Copy** the token
5. **Paste** into Command Center setup (next section)

### Free Tier Limits

- **1 request per 15 seconds** (anonymous)
- **1 request per 5 seconds** (registered, free)
- **Sufficient for casual Jarvis use**

---

## Configure in Command Center

### Method 1: Command Palette (Easiest)

1. **Open Command Palette** (`Ctrl+Shift+P`)
2. **Search for** `Phoenix: Setup Jarvis TTS`
3. **Select the command**
4. **Choose action**:
   - "Configure Gemini API Key"
   - "Configure Pollinations API Key" (optional)
   - "View Current Config"
   - "Test TTS Providers"
5. **Paste your API key** when prompted
6. **Done!** Key is stored securely (encrypted by VS Code)

### Method 2: VS Code Settings

1. **Open Settings** (`Ctrl+,`)
2. **Search for** `phoenix.jarvis`
3. **Look for**:
   - `phoenix.jarvis.ttsProvider`: Choose `gemini-with-fallback` (default)
   - `phoenix.jarvis.gemini.model`: Keep as `gemini-2.5-flash-preview-0001`
   - `phoenix.jarvis.gemini.voice`: British voice (default: `en-GB-Neural2-C`)

**Note**: Don't paste API keys directly in settings.json. They're encrypted in VS Code's SecretStorage instead.

---

## Test Your Setup

### Quick Test

1. **Command Palette** → `Phoenix: Setup Jarvis TTS`
2. **Select** "Test TTS Providers"
3. **Listen** to audio samples for all 4 Jarvis personalities:
   - Serene (calm, warm)
   - Attentive (professional, measured)
   - Alert (concerned, urgent)
   - Escalating (serious, commanding)

### What to Listen For

- ✅ **British accent** clear in all samples
- ✅ **Same voice** across all 4 personalities (not changing to different people)
- ✅ **Emotional variation** (you should hear the mood shift)
- ✅ **No cracking or artifacts** at the start of audio
- ✅ **Clean, natural-sounding delivery**

### Verify in Supervisor

1. **Start Supervisor** (`npm run agents:demo:session` or similar)
2. **Trigger a Jarvis callout** (e.g., submit a command)
3. **Hear Jarvis speak** with emotion
4. **Check VS Code output** for provider info:
   - `[Jarvis TTS] Using: Gemini` (primary)
   - `[Jarvis TTS] Fallback to Pollinations` (if Gemini fails)

---

## Troubleshooting

### "Gemini API key not found"

**Problem**: Setup command ran, but key didn't save.

**Solutions**:
1. Re-run `Phoenix: Setup Jarvis TTS` → "Configure Gemini API Key"
2. Ensure you **pasted the full key** (no spaces at start/end)
3. Check if VS Code is running in **restricted mode** (check status bar)
4. Restart VS Code and try again

### "Gemini TTS failed: 401"

**Problem**: API key is invalid or expired.

**Solutions**:
1. Check key at [Google AI Studio](https://aistudio.google.com/)
2. Try generating a new key
3. Delete old key and configure fresh one:
   - `Phoenix: Setup Jarvis TTS` → "Configure Gemini API Key"
   - Paste new key

### "Gemini TTS failed: 429"

**Problem**: Rate limit hit (too many requests too fast).

**Solutions**:
1. **Wait** a few minutes (quota refreshes)
2. **Reduce frequency** of Jarvis callouts (don't spam)
3. **Fallback will activate** automatically → Pollinations takes over
4. Consider upgrading Gemini to paid tier if regular heavy use

### Audio sounds like different person between emotions

**Problem**: Gemini is changing voice for different personalities (not what we want).

**Solutions**:
1. Confirm `phoenix.jarvis.gemini.voice` is set to **consistent voice**
   - Default: `en-GB-Neural2-C`
   - Other British options: `en-GB-Neural2-D`, `en-GB-Standard-A`
   - Try a different one if issues persist
2. **Report issue** with details:
   - Which Gemini voice you're using
   - Which personalities sound wrong
   - Sample audio (if possible)

### Fallback to Pollinations, but quality sounds off

**Problem**: Gemini exhausted, Pollinations fallback engaged, but audio quality differs.

**Solutions**:
1. **Expected**: Pollinations voice will be slightly different
2. **Acceptable for fallback**: Gemini comes back when quota resets
3. **If consistent issues**:
   - Check Pollinations API key is valid
   - Verify Pollinations voice setting in config
   - Test Pollinations independently in AI Studio

### Enable Debug Logging

For troubleshooting, enable detailed TTS logging:

1. **Open Settings** (`Ctrl+,`)
2. **Search for** `phoenix.jarvis.ttsDebug`
3. **Toggle ON**
4. **Check VS Code Output panel** for:
   - Provider selection (`Using: Gemini`)
   - Fallback events (`Fallback to Pollinations`)
   - Error details (API failures)

---

## Architecture Overview

```
Supervisor triggers Jarvis callout
    ↓
Extension loads config (Gemini + Pollinations)
    ↓
Chat: Generate British summary (Pollinations)
    ↓
TTS: Synthesize audio with emotion (Gemini PRIMARY)
    ├─ Success? → Play audio, done
    └─ Gemini fails (quota, error, etc.)
         ↓
         Fallback: Synthesize with Pollinations
         ↓
         Play fallback audio, continue
```

---

## FAQ

**Q: Is my API key sent to Rivie's servers?**

A: No. Your API key is:
- Stored **locally** in VS Code's encrypted storage
- Sent **directly** to Google or Pollinations API
- **Never** sent to any Phoenix infrastructure

**Q: What if I forget my API key?**

A: You'll need to generate a new one:
1. [Google AI Studio](https://aistudio.google.com/) → Create API Key
2. Re-configure in Command Center via `Phoenix: Setup Jarvis TTS`

The old key cannot be recovered.

**Q: Can I use Pollinations for TTS instead of Gemini?**

A: Yes, but not recommended (Gemini voice is better). If you want:
1. **Open Settings** (`Ctrl+,`)
2. **Set** `phoenix.jarvis.ttsProvider` to `pollinations` (instead of `gemini-with-fallback`)
3. Jarvis will use Pollinations for TTS (still uses Pollinations for chat text)

**Q: Do I need both Gemini AND Pollinations keys?**

A: No:
- **Minimum (Gemini only)**: Just Gemini key
- **Recommended (with fallback)**: Both keys
- **Legacy (Pollinations only)**: Just Pollinations key

**Q: How much does this cost?**

A: **Free tier**: Nothing (1000+ requests/month covered)
- Gemini: Free tier is generous
- Pollinations: Free tier available, 1 req/5 sec

**Paid tier**: Only if you exceed free limits
- Gemini: ~$0.04/hour TTS usage (pay-as-you-go)
- Pollinations: Tiered pricing, starts ~$5/month

---

## Next Steps

1. ✅ Get Gemini API key (required)
2. ✅ Run `Phoenix: Setup Jarvis TTS` to configure
3. ✅ Test with `Test TTS Providers` command
4. ✅ Start Supervisor and hear Jarvis speak
5. ✅ (Optional) Get Pollinations key for fallback

---

## Support

If things go wrong:

1. **Check this guide** (Troubleshooting section above)
2. **Enable debug logging** (`phoenix.jarvis.ttsDebug = true`)
3. **Inspect VS Code output** for error messages
4. **Verify API keys** are valid at their respective consoles
5. **Report issue** with:
   - Error message from output
   - Steps to reproduce
   - Which TTS provider is failing

---
