# Changelog

What has changed in Queueify. The dashboard shows the same list under **What's new**, at
<http://127.0.0.1:3002/#changelog>.

Newest version at the top.

## 43.5.0

### New

- **Icons can have a drop shadow.** Select an icon in the theme editor and turn up **Drop shadow**.
  You can set its angle, blur, and color. Suggested by [olticul](https://github.com/Olticul)
- **The font list shows which font you are using.** Your current font has a green outline, and the
  list opens scrolled to it. Suggested by [olticul](https://github.com/Olticul)

## 43.4.0

### New

- **Queueify connects to OBS as soon as OBS opens.** If you started OBS after Queueify, or
  restarted it mid-stream, scene themes and widget sizing used to stay off until someone typed
  `!tr` or `!bc`
- **A tidier theme-per-scene list.** The Widget themes page shows one row per OBS scene, with its
  theme on the right
  - The scene OBS is showing is marked **On screen**
  - **Unsaved changes** shows until you save
  - A row tells you if its theme has been deleted
  - **Reload scenes** keeps picks you have not saved
- **Assign to OBS scenes from the theme editor.** A new **Assign to OBS scenes** button takes you to
  the scene list on the dashboard

### Fixed

- **The OBS step on the dashboard no longer flickers between Configured and Not configured.** While
  OBS is closed, it shows **Saved - OBS is not open**
- **The dashboard connects to OBS when OBS has a password.** It used to say OBS was not open, even
  while `!tr` and `!bc` worked
- **No more confetti every time you open the dashboard**

## 43.3.0

### New

- **Block an account from using any command.** Add it to the **Command blocklist** on the Admin
  panel's Settings page. Queueify ignores all of its commands, including song requests, even if it
  is a mod. Use this for bots that repeat chat, such as a translation bot copying `!skip`.
  Suggested by [olticul](https://github.com/Olticul)

### Fixed

- **Renaming a theme and changing its design no longer replaces the original.** Saving now asks
  whether to overwrite it or save it as a new theme. Suggested by [olticul](https://github.com/Olticul)
- **Border color None removes the border.** It used to leave a seam along one edge of a gradient.
  Suggested by [olticul](https://github.com/Olticul)
- **Icon color is easier to find.** Selecting an icon shows its color and style settings first.
  Suggested by [olticul](https://github.com/Olticul)
- **Saving with an icon selected no longer shows an error**
- **A theme with icons no longer shows Unsaved changes as soon as you click an icon**
- **Changing something and changing it back no longer leaves Unsaved changes.** This works in the
  theme editor and on all three Admin panel pages

## 43.2.0

### New

- **A fresh look for the dashboard.** It matches the
  [documentation site](https://queueify-docs.vercel.app/getting-started/introduction), with a
  sidebar on every page and a link to the docs. Switch between light and dark with the button in
  the header
- **Spiffy, a new layout to start from.** One slim row with the title, a waveform icon, the artist,
  and a progress bar, on a gradient from the album art. It replaces Ticker and Spotlight under
  **Start from a layout**. Themes you already made from those are not changed
- **A new default theme.** `!theme default` has a new design: album art on the left edge, the
  title in Righteous, song times on both sides of the progress bar, and a gradient from the album
  art. OBS resizes to fit it automatically
- **Classic is now called Default** under **Start from a layout**. It starts you from the new
  default theme. Themes you made from Classic are not changed

### Fixed

- **Title alignment works.** Centered and right-aligned titles used to stay on the left
- **Long centered or right-aligned lines no longer start cut off.** They start scrolling from their
  first word
- **The song times line up on songs over ten minutes**
- **Layout descriptions stay readable when you hover them** under **Start from a layout**

## 43.1.0

### New

- **Round each corner on its own.** Click the button beside **Corner radius** to set each corner
  separately, on the canvas, the album art, or the progress bar. Click it again to go back to one
  radius

## 43.0.0

### New

- **Blur and dim the canvas.** Two new sliders in **Canvas** soften and darken the widget's
  background and artwork, so the text stands out. Your gameplay is not affected
- **A drop shadow on any text.** Turn up **Drop shadow** on the title, artist, or song times. Once
  it is on, you can set its angle, blur, and color
- **Icons.** Over 2,000 icons from [Lucide](https://lucide.dev). Add one from the parts list and
  search by name, such as "heart" or "mic". You can move, resize, color, and rotate it, and it can
  take its color from the album art
- **A waveform progress bar.** Under **Progress bar → Shape**, draw the bar as a row of lines of
  different heights. **Shuffle** gives you a new pattern
- **Place the widget without typing in chat.** **Place in OBS** in the theme editor does what
  `!tr`, `!bc`, `!tr set`, and `!bc set` do
- **A tidier editor.** One toolbar replaces two rows of buttons, and the help is behind the **?**
  button

### Fixed

- **New theme starts a blank theme.** It used to open the layout picker. **Start from a layout** is
  under **⋯**
- **Dropdowns and fields are easier to read**
- **Text outlines are no longer clipped at the top and bottom**

## 42.0.0

### New

- **A Stats page**, at <http://127.0.0.1:3002/stats.html>. It counts from this version on, and
  your stats never leave your computer. It shows:
  - Songs queued, hours of music, unique artists, and unique requesters
  - Top requesters, most requested songs, and most requested artists
  - Why requests were turned away
  - Chat requests vs channel point redeems
  - Busiest hour of the day, and the decade mix
  - Each person's signature song
  - Listening twins, and the longest streak of streams in a row
  - Longest, shortest, oldest, newest, most obscure, and best known song
  - Artists requested exactly once
  - One row per stream
- **The Admin Panel's pages are tabs across the top**
- **`!np` says who queued the song.** It only names someone when Queueify queued that song for
  them. Change the wording in **Admin Panel → Chat messages**
- **Every command can have a cooldown.** Set it in **Admin Panel → Commands**, for the whole chat,
  for each person, or both. Mods skip cooldowns. Only `!np` has one by default

### Fixed

- **Hold the - and + buttons to change a number quickly.** It speeds up the longer you hold
- **Dragging the playhead backwards no longer loses who queued the song,** or counts it as played
  twice

## 41.0.2

### Fixed

- **Spamming `!q` no longer queues the same song several times.** Chat requests and redeems now
  share one cooldown per person. By [meislucas](https://github.com/meislucas)
- **A channel without channel points no longer reconnects in a loop.** Queueify takes chat
  requests only on those channels. By [meislucas](https://github.com/meislucas)

## 41.0.0

### New

- **Song times on the progress bar.** How far into the song you are on one side, and its length on
  the other. You can move, restyle, or hide them. Themes made before this have them turned off
- **An outline on any text.** Add an edge in any color around the title, artist, and song times. It
  keeps text readable over busy gameplay
- **A theme per OBS scene.** Give a scene a theme in **Widget themes** on the dashboard. Queueify
  switches to it when OBS switches to that scene
- **Revert to last save.** One button in the theme editor throws away everything since you last
  saved. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes it
- **A warning when `!tr` or `!bc` need setting again.** After you change a theme's shape, the
  editor tells you which saved position to set again

### Fixed

- **Switching theme no longer flashes a half-drawn widget**
- **The theme editor plays the Canvas video.** The preview used to always show the album cover
- **Themes of a different shape are no longer squashed or cut off in OBS**
- **Saving a theme updates OBS straight away.** You no longer have to refresh the source
- **The editor's size warning is accurate.** It used to warn about designs that were fine
- **Make the OBS window this size now sticks.** It used to undo itself
- **Saved `!tr` and `!bc` positions survive a theme switch.** You no longer have to type the
  command again
- **Saved positions no longer stretch the widget.** Positions that were already stretched fix
  themselves
- **A widget you placed by hand stays where you put it.** It used to shrink a little on every theme
  switch
- **Switching theme puts the widget back where that theme was placed.** It used to creep away from
  the bottom or right edge
- **The widget is no longer slightly stretched after several theme switches**
- **The license is listed as MIT everywhere**

## 40.0.0

### New

- **Setup dashboard.** Connect Twitch, Spotify, and OBS, and create the channel point reward, all
  from one page at <http://127.0.0.1:3002>. It stays open while the bot runs
- **Admin Panel.** Change queue settings, rename commands, and edit every chat message without
  opening a file. Changes apply straight away
- **Visual theme editor.** Drag the album art, title, artist, and progress bar around a canvas,
  then save it as a theme you can switch to with `!theme`. It has 50 fonts, gradients, glow, and
  colors from the album art
- **Share themes.** Export a theme to a file, and anyone running Queueify can import it as a new
  theme
- **Twitch login without a developer app.** Approve Queueify on Twitch and you are done. Logins
  renew themselves
- **Spotify Canvas videos.** Paste your `sp_dc` cookie on the dashboard, and the widget plays
  Spotify's looping clips instead of the album cover. The dashboard shows how to find the cookie
- **Chat commands, listed.** The dashboard lists every command, what it does, who can use it, and
  its aliases

### Changed

- **Nothing needs a restart.** Changes to credentials, settings, aliases, chat messages, themes, and
  `.env` apply while the bot runs
- **The widget stays sharp on its own.** The 1x / 2x / 3x setting is gone, and the widget adjusts
  when you resize it in OBS
- **The widget reloads itself** when the bot starts and when the theme changes
- **Pick your OBS scene and source from a list** instead of typing their names
- **Setup problems are explained.** A command that cannot reach OBS says what is wrong and how to
  fix it

### Fixed

- Turning channel point requests off in the Admin Panel turns off the reward on Twitch. Viewers
  used to keep spending points
- Long titles and artists only scroll when they do not fit
- The queue no longer drifts out of step with what Spotify is playing
- Viewers get their channel points back when their song is refused
- Queueify starts without a channel point reward, so channels that are not Affiliate or Partner can
  use chat requests

## Earlier

- Queueify did not keep a changelog before 40.0.0
