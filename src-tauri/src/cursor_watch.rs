//! Diagnostics: when does the game hide or show the SYSTEM mouse cursor?
//!
//! In mouse-look the game hides the cursor, but the invisible cursor keeps moving; over our window
//! Windows asks OUR window which cursor to show, and the overlay shows an arrow. Letting the window
//! pass the mouse through while the game hides the cursor would cure that, but only if the game
//! really shows the system cursor in its "cursor mode" (and not a cursor of its own while the system one
//! stays hidden). This watcher only measures that; it changes nothing about the window.
//!
//! Every 100 ms a thread reads four flags: the system cursor is visible (`GetCursorInfo`: the display
//! counter of `ShowCursor`), the cursor has a shape (its handle is not null: `SetCursor(NULL)` hides a
//! cursor without touching the counter), the cursor is over our window (the top-level window under it
//! belongs to our process), and our window is the active one. A line goes to the log only when one of
//! the four changes.
//!
//! PRIVACY — the log gets the four flags and a duration in milliseconds, nothing else: no cursor
//! position, no cursor handle (only whether it is null), no window title or class, no name or id of any
//! other process. The position and the window handles are used inside one poll and dropped; the process
//! ids are only compared with ours.
//!
//! The decision "what goes to the log" (`Tracker`) is plain data in, text out, with the time as a
//! parameter, so it is tested without Windows. The Windows calls are in `sys`.

use std::collections::VecDeque;
use std::fmt;
use std::thread;
use std::time::{Duration, Instant};

/// How often the cursor is read.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// The span over which changes are counted, and the length of one summary.
const RATE_WINDOW_MS: u64 = 1_000;

/// More changes than this within `RATE_WINDOW_MS` are flicker: single lines give way to a summary. The poll
/// sees at most one change per `POLL_INTERVAL`, so 10 a second can never be exceeded; 5 can.
const MAX_CHANGES_PER_WINDOW: usize = 5;

/// What one poll found out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CursorState {
    /// The system cursor is visible (`CURSOR_SHOWING`).
    pub visible: bool,
    /// The cursor has a shape: its handle is not null.
    pub shape: bool,
    /// The window under the cursor belongs to our process.
    pub over_overlay: bool,
    /// The active (foreground) window belongs to our process.
    pub overlay_active: bool,
}

impl fmt::Display for CursorState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "visible={} shape={} over_overlay={} overlay_active={}",
            self.visible, self.shape, self.over_overlay, self.overlay_active
        )
    }
}

/// The state that holds now and since when (milliseconds on the watcher's clock).
#[derive(Clone, Copy)]
struct Current {
    state: CursorState,
    since_ms: u64,
}

/// A run of flicker: lines are held back and counted until the window of the summary is over.
#[derive(Clone, Copy)]
struct Burst {
    started_ms: u64,
    changes: usize,
}

/// Decides what is written to the log. Pure: it is told the state and the time and answers with lines.
#[derive(Default)]
pub struct Tracker {
    current: Option<Current>,
    /// When the state changed during the last `RATE_WINDOW_MS`.
    recent_changes: VecDeque<u64>,
    burst: Option<Burst>,
    /// The last read failed, and that has been said already.
    failure_reported: bool,
}

impl Tracker {
    /// Takes one successful poll made at `now_ms` (milliseconds on any clock that does not stop) and returns
    /// the lines to log, usually none. It must be called for every poll, changed or not: a summary is due
    /// when its second is over, not when the next change comes.
    pub fn observe(&mut self, state: CursorState, now_ms: u64) -> Vec<String> {
        self.failure_reported = false;
        let mut lines = Vec::new();
        self.close_summary_window(now_ms, &mut lines);

        let Some(current) = self.current else {
            self.current = Some(Current {
                state,
                since_ms: now_ms,
            });
            lines.push(format!("[cursor] {state}"));
            return lines;
        };
        if current.state == state {
            return lines;
        }
        self.current = Some(Current {
            state,
            since_ms: now_ms,
        });
        self.note_change(now_ms);

        if let Some(burst) = &mut self.burst {
            burst.changes += 1;
        } else if self.recent_changes.len() > MAX_CHANGES_PER_WINDOW {
            // This change is the first one that is not written; it opens the summary window.
            self.burst = Some(Burst {
                started_ms: now_ms,
                changes: 1,
            });
        } else {
            let previous_ms = now_ms.saturating_sub(current.since_ms);
            lines.push(format!("[cursor] {state} prev_ms={previous_ms}"));
        }
        lines
    }

    /// Takes a failed poll. Returns whether to say so: once per run of failures, not once per poll.
    pub fn read_failed(&mut self) -> bool {
        !std::mem::replace(&mut self.failure_reported, true)
    }

    /// Remembers a change at `now_ms` and forgets the ones that are more than a window old.
    fn note_change(&mut self, now_ms: u64) {
        while let Some(&oldest) = self.recent_changes.front() {
            if now_ms.saturating_sub(oldest) < RATE_WINDOW_MS {
                break;
            }
            self.recent_changes.pop_front();
        }
        self.recent_changes.push_back(now_ms);
    }

    /// Ends the summary window when its second is over: says how many changes it held back (if any) and
    /// either opens the next window, when this one was still flicker, or goes back to single lines.
    fn close_summary_window(&mut self, now_ms: u64, lines: &mut Vec<String>) {
        let (Some(burst), Some(current)) = (self.burst, self.current) else {
            return;
        };
        if now_ms.saturating_sub(burst.started_ms) < RATE_WINDOW_MS {
            return;
        }
        if burst.changes > 0 {
            lines.push(format!(
                "[cursor] flicker: changes_in_last_second={} {}",
                burst.changes, current.state
            ));
        }
        self.burst = (burst.changes > MAX_CHANGES_PER_WINDOW).then_some(Burst {
            started_ms: now_ms,
            changes: 0,
        });
    }
}

#[cfg(windows)]
mod sys {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        CURSOR_SHOWING, CURSORINFO, GA_ROOT, GetAncestor, GetCursorInfo, GetForegroundWindow,
        GetWindowThreadProcessId, WindowFromPoint,
    };

    use super::CursorState;

    /// The process that owns `hwnd`. `0` for a null or invalid handle.
    fn window_process_id(hwnd: HWND) -> u32 {
        let mut pid = 0u32;
        // SAFETY: `pid` outlives the call; an invalid handle only leaves `pid` at 0.
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        pid
    }

    pub fn read(own_pid: u32) -> Result<CursorState, String> {
        let mut info = CURSORINFO {
            cbSize: size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        // SAFETY: `info` outlives the call and `cbSize` is set, as the function requires.
        unsafe { GetCursorInfo(&mut info) }
            .map_err(|err| format!("GetCursorInfo failed: {err}"))?;

        // SAFETY: the point is passed by value; a point over no window gives a null handle.
        let under_cursor = unsafe { WindowFromPoint(info.ptScreenPos) };
        // The web content of our window is a child window that the WebView2 browser process may own, so the
        // process is taken from the top-level window above it. A null handle stays null.
        // SAFETY: `GetAncestor` accepts any handle value and returns a null handle for an invalid one.
        let top_under_cursor = unsafe { GetAncestor(under_cursor, GA_ROOT) };
        // SAFETY: no arguments; returns a null handle when there is no foreground window.
        let foreground = unsafe { GetForegroundWindow() };

        Ok(CursorState {
            visible: info.flags.0 & CURSOR_SHOWING.0 != 0,
            shape: !info.hCursor.0.is_null(),
            over_overlay: window_process_id(top_under_cursor) == own_pid,
            overlay_active: window_process_id(foreground) == own_pid,
        })
    }
}

// The app is Windows-only; this stand-in only keeps other platforms compiling.
#[cfg(not(windows))]
mod sys {
    use super::CursorState;

    pub fn read(_own_pid: u32) -> Result<CursorState, String> {
        Err("the cursor watcher needs Windows".to_string())
    }
}

/// The watcher thread: reads the cursor, asks the tracker, logs what it says. It never ends by itself and
/// never panics on a failed read; the process does not wait for it when the app closes.
fn run() {
    let own_pid = std::process::id();
    let clock = Instant::now();
    let mut tracker = Tracker::default();
    loop {
        let now_ms = u64::try_from(clock.elapsed().as_millis()).unwrap_or(u64::MAX);
        match sys::read(own_pid) {
            Ok(state) => {
                for line in tracker.observe(state, now_ms) {
                    log::info!("{line}");
                }
            }
            Err(err) => {
                if tracker.read_failed() {
                    log::warn!("[cursor] {err}");
                }
            }
        }
        thread::sleep(POLL_INTERVAL);
    }
}

/// The watcher runs only when a file of this name lies next to the exe (and the app is restarted).
const WATCH_FLAG: &str = "cursor-watch.flag";

/// Starts the watcher if `cursor-watch.flag` lies next to the exe; says in the log which it is. Call it
/// once, after the log plugin is set up. A failure to start it is logged and the app goes on without the
/// diagnostics.
pub fn start() {
    if !cfg!(windows) {
        return;
    }
    if !crate::logging::flag_next_to_exe(WATCH_FLAG) {
        log::info!("[cursor] watcher off: no {WATCH_FLAG} next to the exe");
        return;
    }
    log::info!("[cursor] watcher on: {WATCH_FLAG} found next to the exe");
    if let Err(err) = thread::Builder::new()
        .name("cursor-watch".into())
        .spawn(run)
    {
        log::warn!("[cursor] cannot start the cursor watcher: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn state(
        visible: bool,
        shape: bool,
        over_overlay: bool,
        overlay_active: bool,
    ) -> CursorState {
        CursorState {
            visible,
            shape,
            over_overlay,
            overlay_active,
        }
    }

    #[test]
    fn the_watcher_is_asked_for_by_the_file_the_readme_names() {
        assert_eq!(WATCH_FLAG, "cursor-watch.flag");
    }

    /// The game hides the cursor with the display counter (`ShowCursor(FALSE)`): the flag is cleared and
    /// the cursor keeps its shape. Our window is neither under the cursor nor active.
    const HIDDEN: CursorState = state(false, true, false, false);
    const SHOWN: CursorState = state(true, true, false, false);
    /// Everything off: the base for "each flag alone".
    const ALL_OFF: CursorState = state(false, false, false, false);

    /// The state after the `i`-th change when the changes alternate and the start is `HIDDEN`.
    fn flip(i: u64) -> CursorState {
        if i % 2 == 1 { SHOWN } else { HIDDEN }
    }

    /// The summary line for `changes` held-back changes, the cursor being in `now` at the end.
    fn summary(changes: usize, now: CursorState) -> String {
        format!("[cursor] flicker: changes_in_last_second={changes} {now}")
    }

    #[test]
    fn the_first_poll_writes_the_state_without_a_previous_duration() {
        let mut t = Tracker::default();
        assert_eq!(
            t.observe(HIDDEN, 40),
            ["[cursor] visible=false shape=true over_overlay=false overlay_active=false"]
        );
    }

    #[test]
    fn a_poll_that_finds_nothing_new_writes_nothing() {
        let mut t = Tracker::default();
        t.observe(SHOWN, 0);
        for i in 1..=50 {
            assert!(t.observe(SHOWN, i * 100).is_empty(), "poll {i}");
        }
    }

    #[test]
    fn a_change_writes_one_line_with_how_long_the_previous_state_lasted() {
        let mut t = Tracker::default();
        t.observe(SHOWN, 1_000);
        assert_eq!(
            t.observe(HIDDEN, 3_450),
            [
                "[cursor] visible=false shape=true over_overlay=false overlay_active=false prev_ms=2450"
            ]
        );
    }

    #[test]
    fn the_duration_runs_from_the_last_change_not_from_the_start() {
        let mut t = Tracker::default();
        t.observe(SHOWN, 0);
        t.observe(HIDDEN, 5_000);
        t.observe(HIDDEN, 5_100);
        assert_eq!(
            t.observe(SHOWN, 5_700),
            [
                "[cursor] visible=true shape=true over_overlay=false overlay_active=false prev_ms=700"
            ]
        );
    }

    #[test]
    fn each_flag_alone_makes_a_change() {
        for changed in [
            state(true, false, false, false),
            state(false, true, false, false),
            state(false, false, true, false),
            state(false, false, false, true),
        ] {
            let mut t = Tracker::default();
            t.observe(ALL_OFF, 0);
            let lines = t.observe(changed, 100);
            assert_eq!(lines, [format!("[cursor] {changed} prev_ms=100")]);
        }
    }

    #[test]
    fn a_game_that_hides_the_cursor_by_dropping_its_shape_is_told_apart_from_one_that_clears_the_flag()
     {
        // `ShowCursor(FALSE)`: the visible flag goes, the shape stays.
        let mut by_counter = Tracker::default();
        by_counter.observe(SHOWN, 0);
        assert_eq!(
            by_counter.observe(HIDDEN, 100),
            [
                "[cursor] visible=false shape=true over_overlay=false overlay_active=false prev_ms=100"
            ]
        );
        // `SetCursor(NULL)`: the shape goes, the visible flag stays.
        let mut by_shape = Tracker::default();
        by_shape.observe(SHOWN, 0);
        assert_eq!(
            by_shape.observe(state(true, false, false, false), 100),
            [
                "[cursor] visible=true shape=false over_overlay=false overlay_active=false prev_ms=100"
            ]
        );
    }

    #[test]
    fn the_line_has_the_four_flags_and_a_duration_and_nothing_else() {
        let mut t = Tracker::default();
        let mut lines = t.observe(HIDDEN, 0);
        lines.extend(t.observe(state(true, true, true, true), 1_234));
        assert_eq!(lines.len(), 2);
        for line in lines {
            let body = line.strip_prefix("[cursor] ").expect("the module prefix");
            for part in body.split(' ') {
                let (key, value) = part.split_once('=').expect("only key=value parts");
                let allowed = match key {
                    "visible" | "shape" | "over_overlay" | "overlay_active" => {
                        value == "true" || value == "false"
                    }
                    "prev_ms" => value.chars().all(|c| c.is_ascii_digit()),
                    _ => false,
                };
                assert!(allowed, "unexpected part {part:?} in {line:?}");
            }
        }
    }

    #[test]
    fn five_changes_in_a_second_are_still_single_lines() {
        let mut t = Tracker::default();
        t.observe(HIDDEN, 0);
        for i in 1..=5 {
            let lines = t.observe(flip(i), i * 10);
            assert_eq!(lines.len(), 1, "change {i}: {lines:?}");
            assert!(lines[0].ends_with("prev_ms=10"));
        }
    }

    #[test]
    fn more_than_five_changes_in_a_second_are_summed_up_instead_of_written_one_by_one() {
        let mut t = Tracker::default();
        t.observe(HIDDEN, 0);
        // Five changes 50 ms apart are single lines; the sixth starts the flicker and is not written.
        for i in 1..=5 {
            assert_eq!(t.observe(flip(i), i * 50).len(), 1, "change {i}");
        }
        assert!(t.observe(flip(6), 300).is_empty());
        // The flicker goes on for the rest of the second, with no line for any change.
        for i in 7..=25 {
            assert!(t.observe(flip(i), i * 50).is_empty(), "change {i}");
        }
        // 1300 ms: the summary window (opened at 300) has run out. 20 changes were held back (6..=25)
        // and the state is that of change 25.
        assert_eq!(t.observe(flip(26), 1_300), [summary(20, flip(25))]);
    }

    #[test]
    fn a_cursor_that_flips_on_every_poll_is_flicker() {
        let mut t = Tracker::default();
        t.observe(HIDDEN, 0);
        // The fastest change the 100 ms poll can see: one per poll.
        for i in 1..=5 {
            assert_eq!(t.observe(flip(i), i * 100).len(), 1, "change {i}");
        }
        assert!(t.observe(flip(6), 600).is_empty());
        for i in 7..=15 {
            assert!(t.observe(flip(i), i * 100).is_empty(), "change {i}");
        }
        // Changes 6..=15 were held back.
        assert_eq!(t.observe(flip(16), 1_600), [summary(10, flip(15))]);
    }

    #[test]
    fn the_summary_is_written_by_a_poll_that_sees_no_change() {
        let mut t = Tracker::default();
        t.observe(HIDDEN, 0);
        for i in 1..=6 {
            t.observe(flip(i), i * 10);
        }
        // 6 changes, the last one (held back) at 60 ms and in state HIDDEN; the window opened then.
        assert!(t.observe(HIDDEN, 1_000).is_empty());
        assert!(t.observe(HIDDEN, 1_059).is_empty());
        assert_eq!(t.observe(HIDDEN, 1_060), [summary(1, HIDDEN)]);
    }

    #[test]
    fn the_summary_repeats_every_second_while_the_flicker_goes_on() {
        let mut t = Tracker::default();
        t.observe(HIDDEN, 0);
        let mut summaries = Vec::new();
        // A change every 50 ms for five seconds.
        for i in 1..=100 {
            for line in t.observe(flip(i), i * 50) {
                if line.contains("flicker") {
                    summaries.push((i * 50, line));
                }
            }
        }
        // The flicker starts at the sixth change (300 ms); a summary follows each second.
        let times: Vec<u64> = summaries.iter().map(|(at, _)| *at).collect();
        assert_eq!(times, [1_300, 2_300, 3_300, 4_300]);
        // 20 changes per second, each window counted from its own start.
        assert!(
            summaries
                .iter()
                .all(|(_, line)| line.contains("changes_in_last_second=20 ")),
            "{summaries:?}"
        );
    }

    #[test]
    fn single_lines_return_when_the_flicker_stops() {
        let mut t = Tracker::default();
        t.observe(HIDDEN, 0);
        for i in 1..=25 {
            t.observe(flip(i), i * 50); // flicker from 300 ms; the last change, 25, is at 1250 ms: SHOWN
        }
        // Nothing changes any more. The window that opened at 300 ms is over at 1300 ms: 20 changes, so the
        // flicker is not over yet and a new window opens.
        assert_eq!(t.observe(SHOWN, 1_300), [summary(20, SHOWN)]);
        // The next window had no change at all: nothing is written, and the flicker is over.
        assert!(t.observe(SHOWN, 2_300).is_empty());
        // A change now is a single line again, and its duration runs from change 25.
        assert_eq!(
            t.observe(HIDDEN, 3_000),
            [
                "[cursor] visible=false shape=true over_overlay=false overlay_active=false prev_ms=1750"
            ]
        );
    }

    #[test]
    fn a_last_window_with_few_changes_is_still_summed_up_and_ends_the_flicker() {
        let mut t = Tracker::default();
        t.observe(HIDDEN, 0);
        for i in 1..=7 {
            t.observe(flip(i), i * 50); // flicker from 300 ms (the 6th change); the 7th is at 350 ms: SHOWN
        }
        // The window of 300 ms holds 2 changes (6th and 7th), which is not flicker any more: it is summed
        // up and the flicker ends.
        assert_eq!(t.observe(SHOWN, 1_300), [summary(2, SHOWN)]);
        // Single lines again.
        assert_eq!(t.observe(HIDDEN, 1_400).len(), 1);
    }

    #[test]
    fn a_change_in_the_poll_that_closes_the_summary_gets_its_own_line_after_it_when_the_flicker_is_over()
     {
        let mut t = Tracker::default();
        t.observe(HIDDEN, 0);
        for i in 1..=7 {
            t.observe(flip(i), i * 50);
        }
        let lines = t.observe(HIDDEN, 1_300);
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert_eq!(lines[0], summary(2, SHOWN));
        assert!(lines[1].ends_with("prev_ms=950"), "{lines:?}");
    }

    #[test]
    fn five_changes_a_second_for_a_minute_never_count_as_flicker() {
        let mut t = Tracker::default();
        t.observe(HIDDEN, 0);
        // One change every 200 ms is exactly five in any second.
        for i in 1..=300 {
            let lines = t.observe(flip(i), i * 200);
            assert_eq!(lines.len(), 1, "change {i}: {lines:?}");
            assert!(!lines[0].contains("flicker"));
        }
    }

    #[test]
    fn a_clock_that_goes_back_does_not_break_anything() {
        let mut t = Tracker::default();
        t.observe(HIDDEN, 5_000);
        assert_eq!(
            t.observe(SHOWN, 4_000),
            ["[cursor] visible=true shape=true over_overlay=false overlay_active=false prev_ms=0"]
        );
    }

    #[test]
    fn a_failed_read_is_reported_once_per_run_of_failures() {
        let mut t = Tracker::default();
        assert!(t.read_failed());
        assert!(!t.read_failed());
        assert!(!t.read_failed());
        // A good read ends the run; the next failure is reported again.
        t.observe(HIDDEN, 0);
        assert!(t.read_failed());
        assert!(!t.read_failed());
    }

    #[test]
    fn a_failed_read_does_not_touch_the_state() {
        let mut t = Tracker::default();
        t.observe(SHOWN, 0);
        t.read_failed();
        // Nothing was lost: the duration still runs from the last good change.
        assert_eq!(
            t.observe(HIDDEN, 900),
            [
                "[cursor] visible=false shape=true over_overlay=false overlay_active=false prev_ms=900"
            ]
        );
    }

    // The test process owns no window and is not the foreground, so a successful read of the real system
    // says "not over us, not active". (A read fails on a locked desktop or without a session: then there is
    // nothing to check.)
    #[cfg(windows)]
    #[test]
    fn reading_the_real_cursor_finds_that_a_process_without_windows_is_not_involved() {
        if let Ok(read) = sys::read(std::process::id()) {
            assert!(!read.over_overlay);
            assert!(!read.overlay_active);
        }
    }
}
