# Jarvis Personality → Gemini TTS Style Instructions Mapping

This document shows how Jarvis's personality-driven system prompts map to Gemini TTS delivery instructions, so you can wire it in once testing confirms it works.

---

## Overview

Currently, `buildJarvisSystemPrompt()` in `jarvisPrompts.ts` generates personality-aware prompts for text generation (chat). We're testing whether we can also drive TTS delivery through Gemini-specific style instructions.

**Goal**: Each personality mode gets both:
1. ✅ Chat system prompt (already working in Command Center)
2. 🧪 TTS style instructions (being tested now with these scenarios)

---

## Personality Mapping: Chat → TTS Style

### SERENE

**Current Chat System Prompt Intent**:
> Everything appears calm. You're relaxed, even slightly cheerful. Offer a warm greeting and ask if the operator wants status or a quick joke.

**Mapped to Gemini TTS Style Instructions**:
```
- Accent: British English (warm RP)
- Tone: Warm, relaxed, and reassuring
- Emotion: Contentment mixed with mild friendliness
- Pace: Unhurried, leisurely (slightly slower than normal)
- Warmth: Convey that everything is well in the world
- Attitude: Like a trusted butler ensuring all is calm
```

**Why This Mapping Works**:
- "Calm and cheerful" chat intent → warm, leisurely TTS delivery
- "Warm greeting" → explicitly request warmth in voice
- "Relaxed" → slower pace, unhurried delivery

---

### ATTENTIVE

**Current Chat System Prompt Intent**:
> Routine operations underway. Speaking tone is measured and professional, offering brief clarity on current state and next action.

**Mapped to Gemini TTS Style Instructions**:
```
- Accent: British English (professional RP)
- Tone: Measured, composed, businesslike
- Emotion: Focused attention with hints of dry humor
- Pace: Normal, professional, crisp
- Clarity: Prioritize clear articulation for tactical information
- Attitude: Like a competent professional briefing a colleague
```

**Why This Mapping Works**:
- "Measured and professional" → explicitly measured tone, normal pace
- "Dry humor" in original system prompt → "hints of dry humor" in TTS style
- "Brief clarity" → crisp delivery, clear articulation
- "Current state and next action" → professional briefing attitude

---

### ALERT

**Current Chat System Prompt Intent**:
> Several items need attention or have been idle. Show slight concern—your tone shifts toward urgency without panic. Clearly prioritize what matters.

**Mapped to Gemini TTS Style Instructions**:
```
- Accent: British English (crisp, professional)
- Tone: Slightly concerned, direct, purposeful
- Emotion: Alertness with underlying responsibility
- Pace: Slightly faster than normal, conveying urgency without panic
- Emphasis: Place subtle stress on action items
- Attitude: Like a reliable advisor noting that attention is genuinely needed
```

**Why This Mapping Works**:
- "Show slight concern" → explicitly request slight concern in tone
- "Urgency without panic" → faster pace but controlled, not frantic
- "Clearly prioritize" → subtle emphasis on key items
- "Tone shifts toward urgency" → tighter delivery and responsibility in attitude

---

### ESCALATING

**Current Chat System Prompt Intent**:
> Critical situation: high-risk approvals pending, multiple errors, or workflow failures. You are noticeably more serious. Show concern for the operator. Give very clear, actionable next steps.

**Mapped to Gemini TTS Style Instructions**:
```
- Accent: British English (sharp, commanding)
- Tone: Serious, urgent, no-nonsense
- Emotion: Genuine concern for the operator, responsibility
- Pace: Controlled but fast, emphasizing importance
- Emphasis: Stress critical information heavily
- Attitude: Like a seasoned commander reporting a situation that demands immediate action
```

**Why This Mapping Works**:
- "Noticeably more serious" → serious, no-nonsense tone
- "Drop the wit entirely" (from original) → removed from these instructions
- "Concern for the operator" → explicitly request genuine concern
- "Very clear, actionable next steps" → controlled but fast delivery with heavy emphasis
- "Critical situation" → commander-like authority and gravity

---

## Implementation Pattern (For Later Wiring)

Once testing confirms Gemini TTS works well, the integration will follow this pattern:

```typescript
// In buildJarvisSystemPrompt() - chat text (already done)
const basePersonality = "You are Jarvis, British, sophisticated..."

// NEW: buildJarvisGeminiTtsStyleInstructions() - TTS delivery
export function buildJarvisGeminiTtsStyleInstructions(
  personality: JarvisPersonalityMode
): string {
  switch (personality) {
    case "serene":
      return `- Accent: British English (warm RP)
- Tone: Warm, relaxed, and reassuring
- Emotion: Contentment mixed with mild friendliness
- Pace: Unhurried, leisurely
- Warmth: Convey that everything is well in the world
- Attitude: Like a trusted butler ensuring all is calm`;
    
    case "attentive":
      return `- Accent: British English (professional RP)
- Tone: Measured, composed, businesslike
- Emotion: Focused attention with hints of dry humor
- Pace: Normal, professional, crisp
- Emphasis: Clear articulation for tactical information`;
    
    // ... etc for alert, escalating
  }
}

// In synthesizeSpeech() - pass to Gemini TTS request
const styleInstructions = buildJarvisGeminiTtsStyleInstructions(personality);
const ttsResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-0001:generateContent", {
  body: JSON.stringify({
    contents: [{
      parts: [{
        text: `[STYLE INSTRUCTIONS]\n${styleInstructions}\n\n[TEXT TO SYNTHESIZE]\n${text}`
      }]
    }]
  })
});
```

---

## Testing Validation

When you test each scenario in AI Studio, specifically evaluate:

| Criterion | Serene | Attentive | Alert | Escalating |
|-----------|--------|-----------|-------|-----------|
| **Accent** | Warm RP | Standard RP | Crisp | Sharp |
| **Speed** | Slow | Normal | Slightly Fast | Fast |
| **Emotion Layer** | Contentment | Dry wit | Concern | Urgency |
| **Confidence** | Reassuring | Professional | Purposeful | Commanding |

If all four sound distinct and match their intent, integration is a go.

---

## Gotchas to Watch

1. **Accent Clarity**: Some TTS models lose British accent under emotional stress. Test all four to confirm accent persists.
2. **Pace vs. Clarity**: At "controlled but fast," don't sacrifice comprehension for speed.
3. **Emotion Without Overacting**: "Genuine concern" shouldn't sound like Jarvis is freaking out.
4. **Consistency**: Voice should still be recognizably Jarvis in all modes, just different emotional layers.

---

## Next Checkpoint

- [ ] Copy each test scenario into AI Studio
- [ ] Listen to all four audio outputs
- [ ] Fill in the evaluation checklist from `JARVIS_GEMINI_TTS_TEST_SCENARIOS.md`
- [ ] Decision: Gemini TTS approved? → Yes/No
- [ ] If Yes: Come back and we wire the integration

---
