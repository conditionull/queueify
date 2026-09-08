# Queueify

A Twitch bot that queues Spotify tracks, plus an OBS overlay widget, a setup
dashboard and a visual theme editor. Node, no build step, no framework.

```
npm start        # the bot + widget (3001) + dashboard (3002)
npm test         # node --test, ~220 tests, no network
npm run screenshot   # capture the widget from a running instance
```

## Rules that actually bite

**Tests must never touch real data.** Every persisted path is overridable:
`QUEUEIFY_THEMES_DIR`, `QUEUEIFY_WIDGET_CONFIG_FILE`, `QUEUEIFY_SETTINGS_FILE`,
`QUEUEIFY_DATA_DIR`, `QUEUEIFY_ENV_FILE`, `QUEUEIFY_SCENE_THEMES_FILE`,
`QUEUEIFY_WIDGET_URL`. **Set them before requiring the module** — `themeStore`,
`widgetLayout`, `core/state` and `widget/server` all read them at load time, so
a `require` above the assignment writes to the real project. Bust
`require.cache` for those modules between sandboxes. Point `QUEUEIFY_WIDGET_URL`
at a dead port so a test can never reach a Queueify the user is running.

**A green test suite does not mean the widget looks right.** Anything touching
the overlay or the editor gets rendered in a real browser and looked at —
Playwright is a devDependency for exactly this. Sample the *first painted frame*
too, not just the settled one: a scene switch reloads the page, so the first
frame is what people actually see.

**OBS sizing is one uniform scale, never one per axis.** `services/obs.js` sets
the browser source size and the scene item transform in a single pass, on
purpose: OBS applies a source resize asynchronously, so reading `sourceWidth`
back straight afterwards returns the *old* number and any scale derived from it
is wrong. Never split that into resize-then-reposition.

**Saved `!tr` / `!bc` positions are rectangles, not scales.** A scale only means
something against the source size it was measured at, and that size changes with
every theme. Nothing outside `services/widgetPresets.js` should compute one.

**Themes are user data.** Adding a field to the theme model means bumping
`MODEL_VERSION` in `services/themeStore.js` *and* giving `normalizeModel` a
fallback, so a theme somebody already saved does not change under them.

**The dashboard is loopback-only.** `setup/server.js` guards on that. It serves
tokens and settings; it must never bind anywhere else.

**Nothing needs a restart.** Credentials, settings, aliases, messages and themes
are re-read while the bot runs. Keep it that way — no boot-time snapshots of
things a user can edit.

## Style

Match the file you are in. No linter, no house style beyond that. Comments
explain *why*, especially where the obvious approach is wrong — most of the
comments in `services/obs.js` and `services/widgetPresets.js` exist because
somebody already made that mistake.

Bullet points do not end in a full stop.

## Reviewing a pull request

See `.github/claude-review.md` for what to prioritise and how to write the
reply.
