# Jarvis Audio Policy

## Non-Negotiable Rules

1. Do not use browser `window.speechSynthesis` for Jarvis supervisor announcements.
2. Jarvis announcement audio must come from AI audio payloads (`audioBase64`) generated upstream.
3. When webview autoplay is blocked, route playback through extension-host native audio handling.
4. Keep webview audio trace logging enabled so blocked autoplay and host playback behavior can be diagnosed from Output logs.

## Why This Exists

- VS Code webviews inherit Chromium autoplay restrictions, so unmuted playback can be denied without user activation.
- This project requires hands-free supervisor announcements.

## Implementation Anchor Points

- Host audio queue: `src/services/JarvisHostAudioPlayer.ts`
- Jarvis payload routing: `src/controller/CommandCenterController.ts`
- Webview receive handling: `media/webview.js`
