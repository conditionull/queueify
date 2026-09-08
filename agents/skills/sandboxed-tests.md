# Writing a test that cannot touch real data

Queueify's tests run against a live install: the same machine holds real
tokens, real themes and real settings. Every one of those is overridable, and a
test that forgets one writes to the user's own files.

## The overrides

| Variable | Replaces |
|---|---|
| `QUEUEIFY_THEMES_DIR` | `widget/themes/` |
| `QUEUEIFY_WIDGET_CONFIG_FILE` | `widget/config.json` |
| `QUEUEIFY_SETTINGS_FILE` | `queue-settings.json` |
| `QUEUEIFY_DATA_DIR` | `queue-state.json`, `queue-pending.json`, `queue-recent.json`, `queue-blacklist.json` |
| `QUEUEIFY_ENV_FILE` | `.env` |
| `QUEUEIFY_SCENE_THEMES_FILE` | `config/scene-themes.json` |
| `QUEUEIFY_WIDGET_URL` | the running widget server |

## Set them before the require

This is the one that bites, and it has bitten:

```js
// Wrong. themeStore read the real widget/themes/ at require time, and
// saveTheme() then wrote a theme into the user's own install.
const store = require('../services/themeStore');
process.env.QUEUEIFY_THEMES_DIR = sandbox;

// Right.
process.env.QUEUEIFY_THEMES_DIR = sandbox;
const store = require('../services/themeStore');
```

`themeStore`, `widgetLayout`, `core/state`, `widget/server` and `setup/server`
all resolve their paths at module load. An assignment after the `require` is
too late, and nothing complains — the test passes while writing to the wrong
place.

## Bust the module cache between sandboxes

Because those paths are captured at load, a second sandbox in the same process
gets the first one's paths unless the modules are re-required:

```js
const modules = [envFilePath, liveEnvPath, storePath, statePath, layoutPath];
for (const m of modules) delete require.cache[require.resolve(m)];
```

Clear the same list again in the `finally`, so the next test file starts clean.
`tests/widget-layout.test.js` and `tests/scene-themes.test.js` both show the
full shape.

## Point the widget URL at a dead port

```js
process.env.QUEUEIFY_WIDGET_URL = 'http://127.0.0.1:9';
```

Without it, `activateTheme` and `saveRenderScale` reach a Queueify the user has
running and change their live overlay. Port 9 refuses instantly, which also
exercises the file-write fallback those functions have.

## Let the writes finish before deleting the sandbox

`core/state` debounces (100ms) and chains its writes. Removing the directory
straight after the assertions races them:

```js
await new Promise(resolve => setTimeout(resolve, 250));
fs.rmSync(sandbox, { recursive: true, force: true });
```

## Standing in for OBS

`services/obs.js` constructs its client at module load, so a fake goes into
`require.cache` for `obs-websocket-js` *before* requiring it — see
`tests/obs-match-widget.test.js`. That fake is also where OBS's real behaviour
gets modelled: `laggyResize` reproduces a browser source resize that OBS has
not applied yet, which is a real bug this repo has already shipped once.

## Scratch scripts count

Anything run by hand during development follows the same rules. A one-off
Playwright script that required `themeStore` before setting the env var is
exactly how a stray `demo` theme once landed in `widget/themes/`.
