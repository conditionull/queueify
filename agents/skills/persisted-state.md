# Changing something that is already on somebody's disk

Themes, saved widget positions and queue settings all live in files a user
already has. A change that reads them differently changes their setup without
asking. These are the rules that keep that from happening.

## Themes: version and fall back

`services/themeStore.js` holds `MODEL_VERSION`, and `normalizeModel` is the only
way a model is read. Adding a field means doing both:

1. Bump `MODEL_VERSION`
2. Give `normalizeModel` a fallback keyed on the *saved* version, so a theme
   written before the field existed keeps behaving as it did

The time labels are the worked example. They are part of every theme, but a
model saved as version 1 gets them hidden:

```js
const savedVersion = Number(raw.version);
const predatesTimes = Number.isFinite(savedVersion) && savedVersion < 2;
// ...
hidden: missing && predatesTimes && TIME_TYPES.includes(type) ? true : Boolean(module.hidden)
```

Note `missing`: a theme that already has an opinion about the field keeps it.
The fallback only applies where the model is silent.

Every value that reaches generated CSS goes through `color()`, `number()`,
`pick()` or `fontKey()`. A theme file is untrusted input — it can be imported
from anyone.

## Do not persist a derived value

The `!tr` / `!bc` bug is the case to learn from. A position was stored as a
*scale*, which only means something against the browser source size it was
measured at — and Queueify recomputes that size on every theme change. So the
stored number silently stopped meaning what it said.

It was then "kept in step" by multiplying every saved scale by the factor the
source had just changed by, which compounded unevenly until saved positions
were visibly stretching the widget.

Store the thing that is true regardless of context — the rectangle on the OBS
canvas — and derive the rest at the moment you need it. If you find yourself
writing code that rewrites stored user data to keep it consistent, the stored
shape is wrong.

## Repair by ignoring, not by rewriting

When the preset shape changed, nothing migrated the damaged values. The new
code reads `width`/`height` and never looks at `scaleX`/`scaleY`, so the bad
field simply stops mattering. No migration pass, nothing to get wrong, and a
user who rolls back still has their file.

Prefer that to editing files in place. If a rewrite really is unavoidable, make
it idempotent and check the existing state before changing it.

## queue-settings.json

`core/state.js` loads once at require time and writes on a 100ms debounce, with
per-file chaining so writes cannot overtake each other. Two consequences:

- A new persisted field has to be added in **both** places — the initialiser and
  `saveSettings()`. Adding it to only one is a field that never survives a
  restart, and nothing fails loudly
- Anything asserting on the written file has to let the debounce settle first

## Never widen what is stored

`queue-settings.json` already holds `spotifyRewardId` and `broadcasterId`.
Tokens live in their own gitignored files and stay there. Do not move a
credential into a settings file to make something more convenient, and do not
log one.
