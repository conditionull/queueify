# Changelog

What has changed in Queueify. The dashboard shows the same list under **What's new**, at
<http://127.0.0.1:3002/#changelog>.

Newest version at the top.

## 44.2.0

### New

- **Songs already in your queue are turned away.** If a viewer asks for a song that's already in
  your Spotify queue, the bot says so instead of adding a second copy
  - Channel points are refunded
  - It's on by default. Switch it off under **Admin Panel → Settings → Turn away songs already in
    the queue**
  - It checks the next 20 songs in your Spotify queue
  - Change the wording in **Admin Panel → Chat messages**

### Fixed

- **`!np` names who queued the song far more reliably.** Some requests used to show no name:
  - Requests made with a link from another country
  - Songs paused for a long time
  - Songs playing when the bot restarts
  - Requests behind more than 20 songs in your Spotify queue
  - Requests ahead of a song you removed from the queue
  - Several viewers requesting at the same moment
- **`!np` no longer names the wrong viewer**
  - A requested song you play yourself before its turn isn't credited to the viewer
  - If you remove a viewer's song and the same song plays straight away, they're still credited
- The widget's **Up next** row names requesters the same way
- **Tier 2 and Tier 3 subs get their tier's effects.** Some were treated as Tier 1
  - Reconnect Twitch on the dashboard to get the new permission scope

## 44.1.0

### New

- **Chat reminder for `!fx`.** The bot can tell chat every so often that subs can pick their own
  song effect. Turn it on under **Admin Panel → Viewer rewards → Chat reminder**
  - Pick how often, from 5 to 240 minutes
  - Write your own message. `{{url}}` becomes the link to the effect picker
  - Set how many chat messages there have to be since the last one before it posts again.
    The bot's own messages don't count
  - It's off until you turn it on

### Fixed

- **Open** next to **Picker page** in Viewer rewards now opens the same short link `!fx` gives
  viewers
- Removed two testing tools that were left in the theme editor by mistake: **Save over premade**
  and **Queue as viewer**

## 44.0.0

### New

- **Premade themes.** **Start from a layout** is now **Premade themes**, a list of finished themes.
  The one you pick plays your current song, at the size it will be in OBS. Pick one, change
  anything, and save it as your own
  - New ones: Frostbite, Pocket, Orbit, Orbit Wide, Pixel Quest, Arcade, Blocky, Vinyl, Snapshot,
    Broadcast, Aurora, Grimoire, and Detached
  - Minimal and Swag are the built-in themes of the same names, as a starting point
  - They're grouped by shape: Banner, Panel, and Portrait
  - Search by name, or by what a theme has in it, such as Pixel or Up next
  - Move through the list with the up and down arrow keys
  - Try each one on a dark, light, or clear backdrop
  - Open it from the button in the theme editor's top bar, or from under the canvas
- **Open the built-in themes in the theme editor.** default, minimal, and swag are at the bottom of
  the theme list, under **Built in (read-only)**
  - They open read-only, so you can look without changing anything
  - To make your own version, change it and save it under a new name
- **Song change animations.** Pick how the art and text change over to the next song: Slide,
  Fade, Flip, Pop, or Wipe, under **Song change** in the theme editor
  - A skip back to the song before runs the other way
  - The colors taken from the album art blend into the new song's
  - Watch one on the preview with **Previous** and **Next**
  - New themes start with Slide. Themes you already have don't change
- **Viewer rewards.** When a song a viewer requested starts, the widget celebrates them. It works
  as it comes. To change it, open **Admin Panel → Viewer rewards**
  - Regulars get an effect once they've requested enough songs: Sparkles from 10, Stars from 50,
    and Embers from 100
  - On a viewer's 10th, 25th, 50th, 100th, 250th, 500th, and 1000th song, the widget steps aside
    for a few seconds and celebrates them by name
  - Subs pick their own effect, and colors if they like. `!fx` links to a page that plays them
    all. Pick one and tap **Copy**, then paste the command, like `!fx glitch gold`, in chat
  - `!fx gold glitch` and `!fx Glitch!` work too
  - Until they pick, Tier 1 subs start with Sparkles, Tier 2 with Scatter, and Tier 3 with
    Lightning. Change any of them under **Subscribers**
  - Keep any effect for Tier 2 or Tier 3 subs under **What subs can pick**. The picker page marks
    those effects with the tier they need. Tier 3 subs get the biggest version of their effect
  - Effects and milestones have a switch each, in the admin panel and in every theme
  - 48 effects in five kinds:
    - Bursts that fill the whole widget
    - Effects that move the widget's own parts, like Scatter, Wave, Glitch, and Spotlight
    - Light shows around it, like Comet, Warp, and Aurora
    - Glow: soft light, like Bokeh, Fairy dust, Shine, and Lens flare
    - Magic: spells, like Rune, Portal, Slash, and Impact
  - Colors: the album's own, Rainbow, Gold, Silver, Ice, Fire, Candy, Neon, or Sunset
  - Try every effect on a sample widget in the admin panel, or over your theme in the editor
  - Milestones, which effects subs can pick, and how each effect looks are under **More
    settings**
  - New themes and the premades have rewards on. Themes you already have start with them off
  - To switch them on in all your themes at once, press **Turn on in every theme** in **Admin
    Panel → Viewer rewards**. Or tick **Reward effects** and **Milestones** in one theme's editor
- **Ambience.** A theme can have something drifting quietly across it while music plays:
  embers, snow, petals, bokeh, fireflies, dust motes, fog, or starlight. Pick one under
  **Ambience** in the theme editor
  - It fades out while a viewer's reward plays, and stops when the music does
  - It's off unless you pick one
- **Search the theme editor's settings.** The box at the top of the settings panel stays put as
  you scroll
  - Type a word like shadow or radius to see only those settings, and the parts with that name
  - Press <kbd>/</kbd> to jump to it, and <kbd>Esc</kbd> to clear it
- **Show all icons.** The icon picker has a button that lists every icon, or every match for what
  you typed, instead of the first 120
- **Up next.** A theme can show what plays next in your Spotify queue. Turn on **Up next** in the
  theme editor's parts list
  - It only appears while something is queued, and fades in and out on its own
  - Show album pictures, and who asked for each song
  - Set **Show** to **Only chat requests** to leave out the rest of your playlist
- **Labels.** Add your own text from the new **Labels** section, such as "Now playing"
  - Write `{requester}` and it becomes the viewer who requested the song. With no requester, the
    label fades out
- **Cards.** Add them from the new **Cards** section. A card is a shape you can put behind any part
  - Pick a color or gradient, and how see-through it is
  - Set its corners, border, and shadow. The border can be a gradient
  - Turn up **Bevel** to make it look like a button
  - Put it behind the album art, or over it as a label
  - Turn up **Frost** to blur the album art behind it
- **More progress bars**
  - A **squiggle**: the played part is a moving wave, and the rest is a plain line
  - A **gradient** fill
  - A **knob** that rides along the bar
- **More album art styles**
  - A border, or a gradient ring
  - **Pixelate**, for a blocky game look. It works on Canvas videos too
  - **Spin**, like a record. It stops when the music does
  - **Blur**. It works on Canvas videos too, and the edges and border stay sharp
- **Pixel fonts:** Press Start 2P, VT323, Silkscreen, and Pixelify Sans
- **Dot matrix fonts:** Doto and DotGothic16, under the new **Dot matrix** group
- **More fonts:** Geist, Geist Mono, Instrument Sans, Instrument Serif, DM Sans, DM Serif Display,
  Bricolage Grotesque, Unbounded, Syne, and Young Serif
- **Select several parts at once** in the theme editor. The toolbar over the canvas shows how
  - Drag a box across them from an empty spot, or from the space around the widget. Everything
    the box touches is selected
  - Hold <kbd>Ctrl</kbd> and click a part to add it, or to take it out. This works in the parts
    list too
  - Drag any selected part to move them all together, or nudge them with the arrow keys
  - Change the settings they have in common all at once, under **Change all of them**. Pick two
    icons to set both line weights, or a title and a label to give them one font
  - Where they're set differently, the setting says **Mixed**. The + and − buttons then move each
    one from its own value
- **Lock a part in place.** Click the padlock next to its eye in the theme editor's parts list
  - A locked part can't be dragged, resized, or nudged
  - Clicks go through it to whatever is underneath, so a card behind everything stays put while you
    work on top of it
  - The lock is saved with the theme
- **Select the canvas** by clicking an empty spot on it, or **Canvas** in the parts list
  - Drag its right or bottom edge to resize it
  - Lock the canvas to keep its size
- **Put any part over another.** Every part has a **Layer** row at the top of its settings
  - **Forward** and **Backward** move it past the next part it overlaps
  - **To front** and **To back** move it all the way
  - Under the buttons it says what the part is over and under
  - Or press <kbd>Ctrl</kbd>+<kbd>]</kbd> and <kbd>Ctrl</kbd>+<kbd>[</kbd>. Add <kbd>Shift</kbd> to go
    all the way
- **Parts can stick out past the panel.** Select the canvas and set **Panel inset**. The panel is
  drawn smaller than the canvas, and anything in the space around it hangs over its edge

### Fixed

- **The theme editor scrolls long titles and artists at the same speed as the widget.** It used to
  scroll them much faster
- **Canvas videos no longer restart every few seconds on stream**
- **Screen readers can name the icon-only buttons,** like the theme editor's padlock and eye, and
  the admin panel's switches
- **Ctrl+S saves in the theme editor,** as the Save button says. It used to open the browser's own
  save dialog

### Changed

- **Admin panel and Stats open straight from the dashboard's sidebar,** without a page in between
- **The Cards, Icons, and Labels headings in the parts list are easier to read,** and show how many
  you have
- **The minimal theme is new.** It's made in the theme editor now, the same as the Minimal premade
  - To make your own version, open it under **Built in (read-only)** and save it under a new name
- **The theme editor's toolbar says that holding <kbd>Ctrl</kbd> while dragging turns snapping off**
- **X, Y, Width, and Height are green in the theme editor,** so they're quicker to find
- **The waveform's Shuffle button is green**
- **A waveform has one Line roundness setting,** for the ends of its lines. The per-corner switch
  is gone from it, since it didn't change anything there
- **Hidden parts no longer show on the theme editor's canvas,** and can't be clicked or dragged
  there. Click one in the parts list to change it
- **Place in OBS and Behavior are always in the theme editor's settings panel,** even with nothing
  selected. You used to have to click a part first
- **The theme editor's preview keeps up with the stream.** The clock and progress bar move every
  second, and a new song shows up as soon as it does in OBS

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
