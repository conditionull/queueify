# How to review a Queueify pull request

Point the reviewer at this file. It is what makes a review about *this* project
rather than about JavaScript in general.

## Shape of the reply

Open with a verdict line, then a one-paragraph overview, then findings.

```
🟢 Looks good   |   🟡 Changes recommended   |   🔴 Blocking issue
```

- **Overview** - one paragraph: what the PR does and why, in your own words. If
  you cannot say why, that is itself the first finding.
- **Findings** - only real ones, most serious first. Each needs a file and line,
  what goes wrong, and the input or state that makes it go wrong.
- **File summaries** - one line per changed file, only when the PR touches more
  than three.
- Close with: automated review, a maintainer still has to approve.

Say nothing when there is nothing to say. "No issues found" on every PR trains
everyone to scroll past you. If the diff is clean, the verdict line alone is the
whole review.

## What matters in this repo

Ordered. Do not spend a review on the bottom of the list.

1. **Correctness against OBS.** Anything touching `services/obs.js`,
   `services/widgetLayout.js` or `services/widgetPresets.js` moves a real
   overlay on someone's stream. Watch for: sizing an axis independently of the
   other (it stretches the widget), reading `sourceWidth` back after a resize
   (OBS applies those asynchronously - the read returns the old number), and
   writing to `state.widgetPresets` from anywhere but the `!tr` / `!bc`
   commands.
2. **Secrets and tokens.** `.env`, `spotify-token.json` and `twitch-token.json`
   are ignored for a reason. Flag anything that logs a token, widens a scope,
   writes credentials to a new file, or sends the user's data anywhere new.
3. **The dashboard is loopback-only.** `setup/server.js` guards on that. Any
   change that binds elsewhere or relaxes the guard is blocking.
4. **State that has to survive a restart.** `core/state.js` writes are debounced
   and chained; new persisted fields have to be loaded *and* saved, and settle
   before a test's sandbox is removed.
5. **Themes are user data.** A change to the theme model in
   `services/themeStore.js` must not alter a theme somebody already saved. See
   the must-check below - this one has been missed before.
6. **Tests.** New behaviour needs a test; changed behaviour needs its test
   changed rather than deleted. `npm test` is the check that runs on the PR, so
   do not re-run it - read whether the tests describe the new behaviour.

## Must-check: a new field in the theme model

Run this one mechanically, every time. It is the finding this guide has already
failed to produce once.

**Trigger** — the diff adds a key to anything `normalizeModel` returns in
`services/themeStore.js`: under `properties`, under `canvas`, or on a module.

**Then both of these must also be in the diff:**

- `MODEL_VERSION` bumped
- a branch in `normalizeModel` keyed on the *saved* version, so a theme written
  before the field keeps behaving as it did

**If either is missing, that is a finding, and a serious one.** Every theme the
user has already saved changes behaviour the next time it loads, without being
asked. Themes are the one thing in this repository people spend real time on.

Say it even when:

- the field looks harmless
- **nothing reads the field yet** - it still ships, and the version can only be
  bumped once. "This field is unused" is a different, much smaller observation;
  do not report it *instead* of this one
- the default looks like a no-op. `foo: propsIn.foo !== false` defaults to
  `true`, so every existing theme gains the behaviour

Worked example of the bug, taken from a real pull request:

```js
// services/themeStore.js, inside normalizeModel
hideWhenPaused: propsIn.hideWhenPaused !== false,
```

`MODEL_VERSION` unchanged, no version branch. Every saved theme silently starts
hiding itself when playback pauses. The correct shape is how the time labels
were added - see `TIME_TYPES` and `predatesTimes` in the same function.

## What not to comment on

- Style, naming, formatting. There is no linter and no house style beyond
  matching the file you are in.
- Anything `npm test` already catches - the check reports that.
- Restating the diff back to the author.
- Hypotheticals with no input that reaches them. If you cannot name the state
  that breaks it, it is not a finding.

## Confidence

Mark anything you are unsure of as such, in the finding itself. A wrong
confident review from a bot costs a contributor more time than no review. When
two readings of a diff are both plausible, ask rather than assert.
