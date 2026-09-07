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
   `services/themeStore.js` must not alter a theme somebody already saved.
   `MODEL_VERSION` plus a fallback in `normalizeModel` is how that is handled -
   check both are present when a field is added.
6. **Tests.** New behaviour needs a test; changed behaviour needs its test
   changed rather than deleted. `npm test` is the check that runs on the PR, so
   do not re-run it - read whether the tests describe the new behaviour.

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
