# SC Trade — a short guide in English

A personal price diary and trade-route helper for Star Citizen: a small window that stays on top of the game. You type
in the prices you see at the in-game terminals; SC Trade keeps them, shows how fresh they are and works out which trip
pays best. [UEX](https://uexcorp.space/) is the reference where you have no prices of your own yet. Everything is
counted on your computer.

This is a short version of the full guide, which is in Russian: [README.md](README.md). Where the two differ, the
Russian one is the reference.

## What the program does not do

- It does not read the game's memory and injects nothing into other processes; it opens no handle of another process.
- It does not read the game's files. The window has no permission for the file system; the program opens only its own
  files (the database, its backups, the log). Its one network address is `api.uexcorp.uk`, for the reference data.
  The window cannot load anything from another address (its CSP allows only the program's own files). Both are pinned
  by tests: `tests/release/permissions.test.ts`, `tests/release/csp.test.ts`. More in [SECURITY.md](SECURITY.md)
  (in Russian, with an English summary at the top).
- It sends no key presses or clicks. The window gets the keyboard only from your click on a text field (or a button
  that opens an entry), and gives it back after the entry: `Esc` at once, or by itself after 15 seconds without a key.
- Hotkeys are optional and none is assigned by default. While one is assigned, Windows calls the program on every key
  press; every press is passed on to the game.

## What you need

- Windows 10 or 11, 64-bit; WebView2 (Windows 11 has it; the installer downloads it otherwise).
- The game in borderless window mode: the window is not drawn over exclusive full screen.
- Internet for the UEX data. Without it the program works on what it has loaded and on your own records.

## Install and first start

1. Run `SC-Trade-1.3.0-setup.exe` (from [sc-trade.space](https://sc-trade.space) or the
   [GitHub release](https://github.com/mob5tertv/sc-trade/releases/latest)). It first asks for its language (the one of
   Windows is preselected, English if Windows speaks neither) and installs for the current user, without administrator
   rights, into `%LOCALAPPDATA%\SC Trade` by default.
2. The file is not signed, so Windows SmartScreen may warn you. Whether to run it is your decision.
3. At the first start the window asks "Язык · Language": one click picks it; you can change it later in
   Settings → Window → Language.
4. A short tutorial follows on a new database: six steps over the real window (ship, location, your own price, where to
   haul, trip, mini line). Skip it at any step; open it again in Settings → Data → Tutorial.
5. Meanwhile the program loads the UEX reference and prices; the progress is in the header ("UEX 23/57").
6. Pick your ship (the first step of the tutorial, or Settings → Ship and search). Without the capacity of the hold
   there are no options and no ROI.

To update: quit the program (tray menu → Quit) and run the new installer. To remove: Windows Settings → Apps; the
dialog has a box to delete the application data too.

## The window

- **Mini line** — the folded window: one line in a corner of the screen. A click unfolds it; the "minus" in the unfolded
  window folds it. It also folds by itself after "Collapse after, s" without the cursor over it.
- **Header** — the location field (three letters of a station and Enter), "Best" (the best trips from your location),
  "Route" (your own pair: from where and to where), the commodity reference (the book), settings and "minus".
- **Terminal table** — the commodities of the terminal you look at, with the price, the stock (SCU), the profit and the
  ROI of the best trip with each. Hover a price to see its UEX minimum and maximum. A click on a row opens it: "Bought",
  "Sold", where to haul it. "+ price" types in a price you see in the game.
- **Price freshness** — a price of your own is hot, warm, cooling, then cold (thresholds in the settings); while it is
  not cold it counts instead of the UEX one. "Changed server" marks all your prices up to now as cold.
- **Options** — where to haul from here (or where to buy for a terminal): profit per trip, time, ROI; sorted by profit or
  by ROI. "Better deal" also offers a purchase at another terminal nearby when the trip pays more.
- **Trip** — the first purchase starts it: a timer, the cargo, the expected profit at the target. "Departed" and
  "Arrived" mark its phases; "Sold" of the last cargo closes it. A trade typed wrong can be corrected in the trip.
- **My routes** — your finished trips: the rating of routes (profit per trip), the history, the sessions and your price
  records ("Records": correct or remove a record). A star makes a route a favourite: the window tells you with a sound
  when the stock at its purchase terminal has grown to a full hold.

## Keys

In Settings → Keys you can assign four actions: expand and collapse the window, the "Departed" mark, the "Arrived" mark,
and the commodity reference (it opens it, unfolding a folded window, and closes it). Click into the field and press the
key. Suitable: `F1`–`F24` except `F5`, `F11` and `F12`, `ScrollLock`, `Pause`, `Insert`, `Home`, `End`, `PageUp`,
`PageDown`, and a letter or digit with `Ctrl` or `Alt`. `Backspace` or `Delete` in the field unassigns the key.

## Where the data is

- Database (settings, your prices, trips, the UEX reference): `%APPDATA%\com.sctrade.app\sctrade.db`; backups in
  `%APPDATA%\com.sctrade.app\backups` (one per start, five kept).
- Logs: `%LOCALAPPDATA%\com.sctrade.app\logs\sctrade.log` (Settings → Data → Open the logs folder). An empty
  `portable.flag` next to `sc-trade.exe` writes a copy of the log next to the exe.

## Building from source

Node.js 24 with npm 11, Rust 1.90 or newer, and the Microsoft C++ build tools and WebView2, as for any Tauri 2
application. Then `npm ci`, `npm test`, `npm run check`, `cargo test --manifest-path src-tauri/Cargo.toml` and
`npm run tauri build`. `npm run preview:ui` shows the interface in a browser without Tauri or the game;
`npm run preview:shot -- --scene expanded --lang en` takes a picture of a scene in English.

## Data source and rights

- The source code of the program and of the site is open, under the MIT licence ([LICENSE](LICENSE)).
- Prices and reference data: UEX (UEX Corp), `api.uexcorp.uk`.
- SC Trade is an unofficial fan-made tool. It is not affiliated with Cloud Imperium Games or Roberts Space Industries
  and is not endorsed by them. Star Citizen and the names from the game are trademarks of their owners.
