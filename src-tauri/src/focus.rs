//! Returning keyboard focus to the game. Before the panel takes focus we remember the window
//! that had it (the game); when the panel closes we give that window the focus back.
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

/// Remembers the window that currently has the keyboard focus. Call it right before the panel
/// takes the focus.
#[tauri::command]
pub fn remember_foreground(state: State<'_, ForegroundState>) {
    let hwnd = sys::foreground_window();
    let pid = sys::window_process_id(hwnd);
    if remember(&state, hwnd, pid, std::process::id()) {
        log::info!("[focus] remembered foreground window {hwnd:#x} (pid {pid})");
    } else {
        log::debug!(
            "[focus] foreground window {hwnd:#x} (pid {pid}) not remembered, keeping {:#x}",
            state.0.load(Ordering::SeqCst)
        );
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
}
