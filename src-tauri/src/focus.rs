//! Who has the keyboard: the game or the panel. Before the panel may take the focus we remember the
//! window that had it (the game); when the panel is done we give that window the focus back.
//!
//! The panel becomes the foreground window in one of two ways, and in no other. The player's own
//! click activates it (the window is made activatable while the pointer is over a text field, and
//! Windows does the rest, as for any window). Or `take_foreground` asks Windows for it: ONE plain
//! `SetForegroundWindow` for our own window. Windows may refuse; a refusal is logged and returned,
//! and nothing is done to change its mind: no synthetic key press, no joining of input queues, no
//! minimise-and-restore, no second try. Nothing synthetic ever enters the input stream.
//!
//! Nothing here touches the game process: it is plain `GetForegroundWindow` / `SetForegroundWindow`.

use std::sync::atomic::{AtomicIsize, Ordering};

use tauri::State;

/// The window to hand the focus back to. `0` means nothing is remembered.
/// Stored as an integer because a raw window handle is not `Send`.
#[derive(Default)]
pub struct ForegroundState(AtomicIsize);

#[cfg(windows)]
mod sys {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SetForegroundWindow,
    };

    fn handle(hwnd: isize) -> HWND {
        HWND(hwnd as *mut core::ffi::c_void)
    }

    pub fn foreground_window() -> isize {
        // SAFETY: no arguments; returns a null handle when there is no foreground window.
        unsafe { GetForegroundWindow() }.0 as isize
    }

    pub fn window_process_id(hwnd: isize) -> u32 {
        let mut pid = 0u32;
        // SAFETY: `pid` outlives the call; an invalid handle only leaves `pid` at 0.
        unsafe { GetWindowThreadProcessId(handle(hwnd), Some(&mut pid)) };
        pid
    }

    pub fn window_exists(hwnd: isize) -> bool {
        // SAFETY: `IsWindow` accepts any handle value.
        unsafe { IsWindow(Some(handle(hwnd))) }.as_bool()
    }

    pub fn set_foreground(hwnd: isize) -> bool {
        // SAFETY: `SetForegroundWindow` accepts any handle value and reports failure by value.
        unsafe { SetForegroundWindow(handle(hwnd)) }.as_bool()
    }

    /// The handle of the panel's own top-level window.
    pub fn own_window(window: &tauri::Window) -> Result<isize, String> {
        window
            .hwnd()
            .map(|hwnd| hwnd.0 as isize)
            .map_err(|err| err.to_string())
    }
}

// The app is Windows-only; these stand-ins only keep other platforms compiling.
#[cfg(not(windows))]
mod sys {
    pub fn foreground_window() -> isize {
        0
    }
    pub fn window_process_id(_hwnd: isize) -> u32 {
        0
    }
    pub fn window_exists(_hwnd: isize) -> bool {
        false
    }
    pub fn set_foreground(_hwnd: isize) -> bool {
        false
    }
    pub fn own_window(_window: &tauri::Window) -> Result<isize, String> {
        Err("window handles are supported on Windows only".into())
    }
}

/// Stores `candidate` unless it is empty or belongs to `own_pid` (our own panel must never be
/// remembered, or closing the panel would "restore" it onto itself). Returns whether it was stored.
fn remember(state: &ForegroundState, candidate: isize, candidate_pid: u32, own_pid: u32) -> bool {
    if candidate == 0 || candidate_pid == own_pid {
        return false;
    }
    state.0.store(candidate, Ordering::SeqCst);
    true
}

/// The level of the line a call of `remember_foreground` writes, or `None` for no line at all.
/// `stored`: a window was remembered; `changed`: it is not the one remembered before. A window
/// that is new is always worth a line at info. Otherwise a call made once (the pointer came over a
/// field, a field was pressed) writes a line below info, and the `quiet` refresh, which runs every
/// 400 ms while the pointer rests on a field, writes nothing.
fn remember_level(stored: bool, changed: bool, quiet: bool) -> Option<log::Level> {
    if stored && changed {
        Some(log::Level::Info)
    } else if quiet {
        None
    } else {
        Some(log::Level::Debug)
    }
}

/// Remembers the window that currently has the keyboard focus. Call it before the panel may take
/// the focus: when the pointer comes over a text field (the click that follows activates the panel,
/// and by then the foreground window is our own, which is never remembered), and again when a
/// field is pressed. While the pointer rests on a field it is called again from time to time with
/// `quiet`, so that the remembered window follows a foreground that changes meanwhile; that call
/// writes a line only when the window did change.
#[tauri::command]
pub fn remember_foreground(state: State<'_, ForegroundState>, quiet: Option<bool>) {
    let hwnd = sys::foreground_window();
    let pid = sys::window_process_id(hwnd);
    let before = state.0.load(Ordering::SeqCst);
    let stored = remember(&state, hwnd, pid, std::process::id());
    let changed = stored && hwnd != before;
    let Some(level) = remember_level(stored, changed, quiet.unwrap_or(false)) else {
        return;
    };
    if changed {
        log::log!(level, "[focus] remembered foreground window {hwnd:#x}");
    } else if stored {
        log::log!(level, "[focus] foreground window {hwnd:#x} is the remembered one already");
    } else {
        log::log!(level, "[focus] foreground window {hwnd:#x} not remembered, keeping {before:#x}");
    }
}

/// Gives the focus back to the remembered window, if it still exists. Returns whether Windows
/// accepted the request.
#[tauri::command]
pub fn restore_foreground(state: State<'_, ForegroundState>) -> bool {
    let hwnd = state.0.load(Ordering::SeqCst);
    if hwnd == 0 {
        log::debug!("[focus] nothing to restore, no window remembered");
        return false;
    }
    if !sys::window_exists(hwnd) {
        log::warn!("[focus] remembered window {hwnd:#x} no longer exists");
        state.0.store(0, Ordering::SeqCst);
        return false;
    }
    let restored = sys::set_foreground(hwnd);
    if restored {
        log::info!("[focus] restored foreground window {hwnd:#x}");
    } else {
        log::warn!("[focus] SetForegroundWindow refused for window {hwnd:#x}");
    }
    restored
}

/// What `take_foreground` came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Taken {
    /// The panel was the foreground window already (the player's click activated it): Windows was not asked.
    AlreadyOurs,
    /// Windows was asked once and agreed.
    Granted,
    /// Windows was asked once and refused, or there is no window to ask for. Nothing else is tried.
    Refused,
}

impl Taken {
    /// The panel is the foreground window now.
    fn in_front(self) -> bool {
        self != Taken::Refused
    }
}

/// Whether `foreground` (what Windows names as the foreground window; `0` when there is none) is the
/// panel's own top-level window `own`.
fn is_ours(own: isize, foreground: isize) -> bool {
    own != 0 && foreground == own
}

/// Makes sure the panel `own` is the foreground window. When it already is, Windows is not asked at
/// all; otherwise `ask` (one `SetForegroundWindow`) is called exactly once and its answer is final.
/// `FnOnce`: a second request cannot even be written.
fn take(own: isize, foreground: isize, ask: impl FnOnce(isize) -> bool) -> Taken {
    if is_ours(own, foreground) {
        Taken::AlreadyOurs
    } else if own != 0 && ask(own) {
        Taken::Granted
    } else {
        Taken::Refused
    }
}

/// The player pressed a text field of the panel: makes sure the panel is the foreground window, so
/// that the keys go to it. Returns whether it is. Call it after `remember_foreground` and after the
/// window was made activatable. See the head of this file for what is never done here.
#[tauri::command]
pub fn take_foreground(window: tauri::Window) -> bool {
    let own = match sys::own_window(&window) {
        Ok(own) => own,
        Err(err) => {
            log::error!("[focus] cannot ask for the foreground, no window handle: {err}");
            return false;
        }
    };
    let outcome = take(own, sys::foreground_window(), sys::set_foreground);
    match outcome {
        Taken::AlreadyOurs => {
            log::info!("[focus] the panel is the foreground window already (asked: false)")
        }
        Taken::Granted => {
            log::info!("[focus] Windows made the panel the foreground window (asked: true)")
        }
        Taken::Refused => {
            log::warn!("[focus] Windows refused to make the panel the foreground window")
        }
    }
    outcome.in_front()
}

/// Whether the panel is the foreground window right now. This is Windows' answer, not the focus of
/// the web page: the page reports a focus even when its window was never activated. Not logged (it
/// is asked by timers); without a window handle the answer is "no".
#[tauri::command]
pub fn panel_is_foreground(window: tauri::Window) -> bool {
    sys::own_window(&window).is_ok_and(|own| is_ours(own, sys::foreground_window()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWN_PID: u32 = 100;

    #[test]
    fn remembers_a_foreign_window() {
        let state = ForegroundState::default();
        assert!(remember(&state, 0x1234, 200, OWN_PID));
        assert_eq!(state.0.load(Ordering::SeqCst), 0x1234);
    }

    #[test]
    fn never_remembers_our_own_window() {
        let state = ForegroundState::default();
        assert!(remember(&state, 0x1234, 200, OWN_PID));
        assert!(!remember(&state, 0x9999, OWN_PID, OWN_PID));
        assert_eq!(state.0.load(Ordering::SeqCst), 0x1234);
    }

    #[test]
    fn ignores_a_missing_foreground_window() {
        let state = ForegroundState::default();
        assert!(!remember(&state, 0, 0, OWN_PID));
        assert_eq!(state.0.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_newly_remembered_window_is_a_line_at_info_asked_quietly_or_not() {
        assert_eq!(remember_level(true, true, false), Some(log::Level::Info));
        assert_eq!(remember_level(true, true, true), Some(log::Level::Info));
    }

    #[test]
    fn asked_once_the_same_window_or_none_is_a_line_at_debug() {
        // the pointer came over a field, a field was pressed: one line each, below info
        assert_eq!(remember_level(true, false, false), Some(log::Level::Debug));
        assert_eq!(remember_level(false, false, false), Some(log::Level::Debug));
    }

    #[test]
    fn the_quiet_refresh_writes_nothing_while_nothing_changes() {
        // it runs every 400 ms while the pointer rests on a field: not a line at any level
        assert_eq!(remember_level(true, false, true), None);
        assert_eq!(remember_level(false, false, true), None);
    }

    const PANEL: isize = 0x5151;
    const GAME: isize = 0x1234;

    #[test]
    fn the_panel_in_front_is_ours_and_nothing_else_is() {
        assert!(is_ours(PANEL, PANEL));
        assert!(!is_ours(PANEL, GAME));
        // no foreground window at all (the desktop is switching)
        assert!(!is_ours(PANEL, 0));
        // without a handle of our own nothing is ours, not even "no window"
        assert!(!is_ours(0, 0));
    }

    #[test]
    fn asks_nothing_when_the_panel_is_already_in_front() {
        let outcome = take(PANEL, PANEL, |_| panic!("Windows must not be asked"));
        assert_eq!(outcome, Taken::AlreadyOurs);
        assert!(outcome.in_front());
    }

    #[test]
    fn asks_once_for_its_own_window_when_the_game_is_in_front() {
        let mut asked = Vec::new();
        let outcome = take(PANEL, GAME, |hwnd| {
            asked.push(hwnd);
            true
        });
        assert_eq!(outcome, Taken::Granted);
        assert!(outcome.in_front());
        assert_eq!(asked, vec![PANEL]);
    }

    #[test]
    fn a_refusal_is_final_nothing_is_tried_after_it() {
        let mut asked = 0;
        let outcome = take(PANEL, GAME, |_| {
            asked += 1;
            false
        });
        assert_eq!(outcome, Taken::Refused);
        assert!(!outcome.in_front());
        assert_eq!(asked, 1);
    }

    #[test]
    fn asks_when_there_is_no_foreground_window() {
        let mut asked = 0;
        let outcome = take(PANEL, 0, |_| {
            asked += 1;
            true
        });
        assert_eq!(outcome, Taken::Granted);
        assert_eq!(asked, 1);
    }

    #[test]
    fn without_a_window_of_our_own_nothing_is_asked() {
        let refused = take(0, GAME, |_| panic!("there is no window to ask for"));
        assert_eq!(refused, Taken::Refused);
        assert_eq!(take(0, 0, |_| panic!("there is no window to ask for")), Taken::Refused);
    }
}
