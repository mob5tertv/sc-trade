//! Placing the overlay window. The window is as big as its content, so the size changes whenever the
//! content does, and the position follows (the window is glued to a corner of the monitor). Moving and
//! resizing it in two calls would show a frame in which the window has already moved and not yet
//! grown; here both are set by ONE `SetWindowPos`, in physical pixels of the desktop, and the window
//! is neither activated nor reordered, so the game keeps the focus.

/// A window with no area cannot be placed; a number this big is a mistake of the caller, not a monitor.
const MAX_SIDE: i32 = 32_000;

fn check_size(width: i32, height: i32) -> Result<(), String> {
    if !(1..=MAX_SIDE).contains(&width) || !(1..=MAX_SIDE).contains(&height) {
        return Err(format!("cannot place a window of {width}x{height}"));
    }
    Ok(())
}

#[cfg(windows)]
mod sys {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};

    pub fn place(hwnd: isize, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
        let hwnd = HWND(hwnd as *mut core::ffi::c_void);
        // SAFETY: `hwnd` is the handle of this application's own window, taken from Tauri right before the
        // call; every other argument is a plain number. A stale handle makes the call fail, not crash.
        unsafe { SetWindowPos(hwnd, None, x, y, width, height, SWP_NOACTIVATE | SWP_NOZORDER) }
            .map_err(|err| format!("SetWindowPos failed: {err}"))
    }
}

/// Places `window` in the rectangle (physical pixels of the desktop) with one call that moves and
/// resizes it together and does not activate it. Fails for a rectangle with no area.
#[cfg(windows)]
#[tauri::command]
pub fn place_window(window: tauri::Window, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    check_size(width, height)?;
    let hwnd = window.hwnd().map_err(|err| format!("no window handle: {err}"))?;
    // A success is not logged here: this runs for every frame of a drag. The window layer in the webview logs each new
    // rectangle that is not part of a drag; only a failure is worth a line from this side.
    sys::place(hwnd.0 as isize, x, y, width, height).inspect_err(|err| log::error!("[place] {err}"))
}

// The app is Windows-only; this stand-in only keeps other platforms compiling.
#[cfg(not(windows))]
#[tauri::command]
pub fn place_window(_window: tauri::Window, _x: i32, _y: i32, width: i32, height: i32) -> Result<(), String> {
    check_size(width, height)?;
    Err("placing the window is supported on Windows only".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_real_window() {
        assert!(check_size(440, 300).is_ok());
        assert!(check_size(1, 1).is_ok());
        assert!(check_size(MAX_SIDE, MAX_SIDE).is_ok());
    }

    #[test]
    fn refuses_a_window_with_no_area() {
        assert!(check_size(0, 300).is_err());
        assert!(check_size(440, 0).is_err());
        assert!(check_size(-440, 300).is_err());
        assert!(check_size(440, -1).is_err());
    }

    #[test]
    fn refuses_a_size_that_is_not_a_monitor() {
        assert!(check_size(MAX_SIDE + 1, 300).is_err());
        assert!(check_size(440, i32::MAX).is_err());
    }

    #[test]
    fn says_which_size_it_refused() {
        assert_eq!(check_size(0, 26).unwrap_err(), "cannot place a window of 0x26");
    }
}
