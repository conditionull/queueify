# Verifying a widget or editor change by looking at it

A green test suite says the code does what the test says. It says nothing about
whether the overlay looks right on stream. Every widget or theme-editor change
gets rendered in a real browser and looked at before it is called done.

Playwright is a devDependency for exactly this. It is not in the CI job, because
CI installs with `--omit=dev`; this is a local step.

## The quick path

With Queueify running:

```
npm run screenshot                      # http://localhost:3001 -> widget-screenshot.png
npm run screenshot -- <url> <out.png>
```

## The thorough path

Serve a theme against a stubbed song so the render is deterministic, then drive
it. The shape:

1. Set the sandbox env vars **before** requiring anything (see
   `sandboxed-tests.md` — this is where the stray `demo` theme came from)
2. `store.saveTheme(...)` a model into the sandbox
3. Stub `spotify.getCurrentTrack` — include a delay, because the real one has one
4. Start `widget/server.js`, point Playwright at it with a viewport matching the
   OBS browser source
5. Assert on computed style and `getBoundingClientRect()`, then screenshot

## Sample the first painted frame, not just the settled one

A theme switch reloads the page, so the *first* frame is what people actually
see on every scene change. Poll it:

```js
await page.goto(url, { waitUntil: 'commit' });
for (let i = 0; i < 28; i += 1) {
  seen.push(await page.evaluate(() => ({
    t: Math.round(performance.now()),
    zoom: getComputedStyle(document.documentElement).zoom,
    width: Math.round(document.querySelector('.widget').getBoundingClientRect().width),
    visible: Number(getComputedStyle(document.querySelector('.widget')).opacity) > 0.01
  })));
  await page.waitForTimeout(100);
}
```

That is how the "black bars for a few seconds" report was found and fixed: 220
tests passed throughout, and the first frame was drawing the design at 1x inside
a source sized for 2x. The numbers that mattered were *frames visible at the
wrong size* and *frames visible with no song*, both of which should be zero.

## What to check

- **Aspect ratio.** The rendered width divided by height must match the design's.
  A widget that is subtly stretched looks like nothing is wrong in a screenshot
  taken on its own — compare the ratio numerically
- **Uniform scale.** `scaleX` and `scaleY` sent to OBS must be equal. Unequal
  values have shipped here before and compounded over theme switches
- **The reveal.** Nothing should be visible before there is a song to draw
- **Both themes of a switch.** Render the theme you are leaving and the one you
  are arriving at; most sizing bugs only appear in the transition

## Screenshot the editor too

The theme editor is a UI with its own failure modes — the fit warning, the parts
list, the preview. `setup/server.js`'s `createApp()` can be started against a
sandbox and driven the same way. Check the browser console for page errors while
you are there; several editor bugs surfaced as a silent `pageerror` rather than
anything visible.
