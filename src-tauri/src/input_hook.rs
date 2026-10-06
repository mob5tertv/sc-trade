//! Optional trigger keys ("panel", "depart", "arrive"), caught by a low-level keyboard hook.
//! Windows global hotkeys never fire while the game is in the foreground; a low-level hook does.
//!
//! PRIVACY — the hook procedure looks only at the keys that are assigned right now:
//! - `Tracker::handle` is plain data in, data out: no logging, no I/O. For a key that is not
//!   assigned it returns before it reads anything else (not even the modifier state) and stores
//!   nothing. The tests below pin that down.
//! - A trigger is logged by its name (`panel`, `depart`, `arrive`), never by its key.
//! - The hook procedure never swallows an event: it always ends in `CallNextHookEx`, so the game
//!   receives every key as well.
//!
//! The hook lives only while at least one key is assigned. It runs on its own thread with a
//! message loop. The procedure does nothing slow: a fired trigger is handed to another thread
//! that logs it and emits the event to the webview.

use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError, mpsc};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::keys::{KeyCombo, parse_key};

/// Event the webview listens to. The payload is `{ "name": "panel" | "depart" | "arrive" }`.
pub const TRIGGER_EVENT: &str = "input://trigger";

const TRIGGER_COUNT: usize = 3;

// Window messages as plain numbers, so that the logic below is ordinary testable code.
const WM_KEYDOWN: u32 = 0x0100;
const WM_KEYUP: u32 = 0x0101;
const WM_SYSKEYDOWN: u32 = 0x0104;
const WM_SYSKEYUP: u32 = 0x0105;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
    Panel,
    Depart,
    Arrive,
}

impl Trigger {
    /// In the order of the `set_trigger_keys` arguments.
    const ALL: [Trigger; TRIGGER_COUNT] = [Trigger::Panel, Trigger::Depart, Trigger::Arrive];

    pub fn name(self) -> &'static str {
        match self {
            Trigger::Panel => "panel",
            Trigger::Depart => "depart",
            Trigger::Arrive => "arrive",
        }
    }
}

#[derive(Clone, Serialize)]
struct TriggerPayload {
    name: &'static str,
}

/// Whether `vk` pressed with exactly these modifiers is the combination `combo`.
pub fn matches(combo: &KeyCombo, vk: u32, ctrl: bool, alt: bool, shift: bool) -> bool {
    combo.vk == vk && combo.ctrl == ctrl && combo.alt == alt && combo.shift == shift
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Modifiers {
    ctrl: bool,
    alt: bool,
    shift: bool,
}

/// The assigned combinations and which of their keys are physically down.
struct Tracker {
    combos: [Option<KeyCombo>; TRIGGER_COUNT],
    /// The key of this trigger went down and has not come up yet. Auto-repeat sends further
    /// key-downs; one press must fire once. Set for any key-down of the assigned key, matching
    /// modifiers or not, so that joining Ctrl+Alt to an already held key does not fire it.
    held: [bool; TRIGGER_COUNT],
}

impl Tracker {
    const fn new() -> Self {
        Tracker {
            combos: [None; TRIGGER_COUNT],
            held: [false; TRIGGER_COUNT],
        }
    }

    fn assign(&mut self, combos: [Option<KeyCombo>; TRIGGER_COUNT]) {
        self.combos = combos;
        self.held = [false; TRIGGER_COUNT];
    }

    fn any_assigned(&self) -> bool {
        self.combos.iter().any(Option::is_some)
    }

    /// Looks at one keyboard message. `modifiers` is called at most once, and only when `vk` is an
    /// assigned key. Returns the trigger to fire (the first one if several share the combination).
    fn handle(&mut self, msg: u32, vk: u32, modifiers: impl Fn() -> Modifiers) -> Option<Trigger> {
        let Tracker { combos, held } = self;
        match msg {
            WM_KEYDOWN | WM_SYSKEYDOWN => {
                let mut read: Option<Modifiers> = None;
                let mut fired = None;
                for (i, slot) in combos.iter().enumerate() {
                    let Some(combo) = slot else { continue };
                    if combo.vk != vk {
                        continue;
                    }
                    let first_down = !held[i];
                    held[i] = true;
                    if !first_down || fired.is_some() {
                        continue;
                    }
                    let m = *read.get_or_insert_with(&modifiers);
                    if matches(combo, vk, m.ctrl, m.alt, m.shift) {
                        fired = Some(Trigger::ALL[i]);
                    }
                }
                fired
            }
            WM_KEYUP | WM_SYSKEYUP => {
                for (i, slot) in combos.iter().enumerate() {
                    if slot.is_some_and(|combo| combo.vk == vk) {
                        held[i] = false;
                    }
                }
                None
            }
            _ => None,
        }
    }
}

static TRACKER: Mutex<Tracker> = Mutex::new(Tracker::new());
/// Fired triggers, from the hook thread to the thread that logs and emits them.
static SINK: OnceLock<mpsc::Sender<Trigger>> = OnceLock::new();

fn tracker() -> MutexGuard<'static, Tracker> {
    // The tracker holds plain data that is valid at every point, so a poisoned lock is still usable.
    TRACKER.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What the hook procedure does with one keyboard message.
#[cfg(windows)]
fn on_key_message(msg: u32, vk: u32) {
    let fired = tracker().handle(msg, vk, sys::modifiers_held);
    if let Some(trigger) = fired
        && let Some(tx) = SINK.get()
    {
        let _ = tx.send(trigger);
    }
}

#[cfg(windows)]
mod sys {
    use std::sync::mpsc;
    use std::thread::{self, JoinHandle};

    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, HC_ACTION, KBDLLHOOKSTRUCT, MSG,
        PM_NOREMOVE, PeekMessageW, PostThreadMessageW, SetWindowsHookExW, TranslateMessage,
        UnhookWindowsHookEx, WH_KEYBOARD_LL, WM_QUIT, WM_USER,
    };
    use windows::core::PCWSTR;

    use super::{Modifiers, on_key_message};

    /// The thread that owns the hook and pumps its messages.
    pub struct HookThread {
        thread_id: u32,
        join: JoinHandle<()>,
    }

    impl HookThread {
        /// Installs the hook on a new thread. Returns once the hook is in place or has failed.
        pub fn start() -> Result<HookThread, String> {
            let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<u32, String>>(1);
            let join = thread::Builder::new()
                .name("input-hook".into())
                .spawn(move || run(ready_tx))
                .map_err(|err| format!("cannot start the hook thread: {err}"))?;
            match ready_rx.recv() {
                Ok(Ok(thread_id)) => Ok(HookThread { thread_id, join }),
                Ok(Err(reason)) => {
                    let _ = join.join();
                    Err(reason)
                }
                Err(_) => {
                    let _ = join.join();
                    Err("the hook thread ended before the hook was installed".to_string())
                }
            }
        }

        /// Asks the message loop to end; the thread then removes the hook.
        pub fn request_stop(&self) -> Result<(), String> {
            // SAFETY: plain call; the thread has a message queue (see `run`).
            unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) }
                .map_err(|err| format!("cannot stop the hook thread: {err}"))
        }

        /// Waits until the thread is gone (the hook is removed by then).
        pub fn join(self) {
            if self.join.join().is_err() {
                log::error!("[hook] the hook thread panicked");
            }
        }
    }

    /// Current state of the modifier keys. Read only after a key that is assigned went down.
    pub fn modifiers_held() -> Modifiers {
        let down = |vk: i32| {
            // SAFETY: plain query.
            (unsafe { GetAsyncKeyState(vk) } as u16) & 0x8000 != 0
        };
        Modifiers {
            ctrl: down(i32::from(VK_CONTROL.0)),
            alt: down(i32::from(VK_MENU.0)),
            shift: down(i32::from(VK_SHIFT.0)),
        }
    }

    unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            // SAFETY: for `WH_KEYBOARD_LL` with code `HC_ACTION`, `lparam` points to a KBDLLHOOKSTRUCT.
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            on_key_message(wparam.0 as u32, info.vkCode);
        }
        // Never swallow anything: the game gets every key as well.
        // SAFETY: the arguments are passed on untouched.
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    fn run(ready: mpsc::SyncSender<Result<u32, String>>) {
        // SAFETY: plain Win32 calls; `keyboard_proc` lives for the whole process.
        let hook = unsafe {
            let module = match GetModuleHandleW(PCWSTR::null()) {
                Ok(module) => module,
                Err(err) => {
                    let _ = ready.send(Err(format!("GetModuleHandleW failed: {err}")));
                    return;
                }
            };
            match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), Some(module.into()), 0) {
                Ok(hook) => hook,
                Err(err) => {
                    let _ = ready.send(Err(format!("SetWindowsHookExW failed: {err}")));
                    return;
                }
            }
        };

        let mut msg = MSG::default();
        // SAFETY: `msg` outlives the calls. Peeking creates this thread's message queue, so that
        // the WM_QUIT posted by `request_stop` cannot get lost before the first `GetMessageW`.
        let _ = unsafe { PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE) };
        // SAFETY: plain query.
        let _ = ready.send(Ok(unsafe { GetCurrentThreadId() }));

        loop {
            // SAFETY: `msg` outlives the calls.
            let got = unsafe { GetMessageW(&mut msg, None, 0, 0) }.0;
            if got == 0 {
                break; // WM_QUIT
            }
            if got < 0 {
                log::error!("[hook] the message loop failed ({got}), stopping");
                break;
            }
            // SAFETY: `msg` was filled by `GetMessageW`.
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        // SAFETY: `hook` was returned by `SetWindowsHookExW` on this thread.
        if let Err(err) = unsafe { UnhookWindowsHookEx(hook) } {
            log::warn!("[hook] UnhookWindowsHookEx failed: {err}");
        }
    }
}

// The app is Windows-only; this stand-in only keeps other platforms compiling.
#[cfg(not(windows))]
mod sys {
    pub struct HookThread;

    impl HookThread {
        pub fn start() -> Result<HookThread, String> {
            Err("keyboard triggers need Windows".to_string())
        }
        pub fn request_stop(&self) -> Result<(), String> {
            Ok(())
        }
        pub fn join(self) {}
    }
}

/// Owns the hook thread while a hook is installed.
#[derive(Default)]
pub struct HookController {
    hook: Mutex<Option<sys::HookThread>>,
}

/// Thread that logs every fired trigger and tells the webview. Started once, with the first hook.
fn ensure_event_thread(app: &AppHandle) -> Result<(), String> {
    if SINK.get().is_some() {
        return Ok(());
    }
    let (tx, rx) = mpsc::channel::<Trigger>();
    let app = app.clone();
    thread::Builder::new()
        .name("input-trigger".into())
        .spawn(move || {
            for trigger in rx {
                log::info!("[hook] trigger fired: {}", trigger.name());
                let payload = TriggerPayload {
                    name: trigger.name(),
                };
                if let Err(err) = app.emit(TRIGGER_EVENT, payload) {
                    log::error!("[hook] cannot emit {TRIGGER_EVENT}: {err}");
                }
            }
        })
        .map_err(|err| format!("cannot start the trigger thread: {err}"))?;
    // Calls are serialised by the controller lock, so this cannot lose a race.
    let _ = SINK.set(tx);
    Ok(())
}

/// Turns the three key texts into combinations. Returns the combinations and, per trigger, `None`
/// (assigned or empty) or the reason the text was rejected. A blank text means "not assigned".
fn parse_assignments(
    texts: &[String; TRIGGER_COUNT],
) -> ([Option<KeyCombo>; TRIGGER_COUNT], Vec<Option<String>>) {
    let mut combos = [None; TRIGGER_COUNT];
    let mut outcome = Vec::with_capacity(TRIGGER_COUNT);
    for (i, text) in texts.iter().enumerate() {
        if text.trim().is_empty() {
            outcome.push(None);
            continue;
        }
        match parse_key(text) {
            Ok(combo) => {
                combos[i] = Some(combo);
                outcome.push(None);
            }
            Err(reason) => outcome.push(Some(reason)),
        }
    }
    (combos, outcome)
}

fn log_assignment(
    texts: &[String; TRIGGER_COUNT],
    combos: &[Option<KeyCombo>; TRIGGER_COUNT],
    outcome: &[Option<String>],
) {
    for (i, reason) in outcome.iter().enumerate() {
        if let Some(reason) = reason {
            log::warn!(
                "[hook] key for {} rejected: {reason}",
                Trigger::ALL[i].name()
            );
        }
    }
    if combos.iter().all(Option::is_none) {
        log::info!("[hook] no trigger keys assigned");
        return;
    }
    let shown: Vec<String> = Trigger::ALL
        .iter()
        .enumerate()
        .map(|(i, trigger)| {
            let key = if combos[i].is_some() {
                texts[i].trim()
            } else {
                "-"
            };
            format!("{}={key}", trigger.name())
        })
        .collect();
    log::info!("[hook] trigger keys assigned: {}", shown.join(", "));
}

fn apply(
    app: &AppHandle,
    controller: &HookController,
    texts: [String; TRIGGER_COUNT],
) -> Result<Vec<Option<String>>, String> {
    let (combos, outcome) = parse_assignments(&texts);
    log_assignment(&texts, &combos, &outcome);

    // Held for the whole change: installing and removing the hook never overlap.
    let mut hook = controller
        .hook
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    tracker().assign(combos);

    let wanted = tracker().any_assigned();
    match (wanted, hook.is_some()) {
        (true, false) => {
            let started = ensure_event_thread(app).and_then(|()| sys::HookThread::start());
            match started {
                Ok(thread) => {
                    *hook = Some(thread);
                    log::info!("[hook] keyboard hook installed");
                }
                Err(reason) => {
                    log::error!("[hook] cannot install the keyboard hook: {reason}");
                    tracker().assign([None; TRIGGER_COUNT]);
                    return Err(reason);
                }
            }
        }
        (false, true) => {
            if let Some(thread) = hook.as_ref()
                && let Err(reason) = thread.request_stop()
            {
                log::error!("[hook] cannot remove the keyboard hook: {reason}");
                return Err(reason);
            }
            if let Some(thread) = hook.take() {
                thread.join();
                log::info!("[hook] keyboard hook removed");
            }
        }
        _ => {}
    }
    Ok(outcome)
}

/// Assigns the trigger keys and installs or removes the keyboard hook to match. An empty string
/// means "not assigned". Returns, for panel / depart / arrive, `None` or the reason the text
/// could not be used. Safe to call again with the same keys (a reloaded webview does).
#[tauri::command]
pub fn set_trigger_keys(
    app: AppHandle,
    controller: State<'_, HookController>,
    panel: String,
    depart: String,
    arrive: String,
) -> Result<Vec<Option<String>>, String> {
    apply(&app, &controller, [panel, depart, arrive])
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    const NONE: Modifiers = Modifiers {
        ctrl: false,
        alt: false,
        shift: false,
    };
    const CTRL_ALT: Modifiers = Modifiers {
        ctrl: true,
        alt: true,
        shift: false,
    };

    fn combo(text: &str) -> Option<KeyCombo> {
        Some(parse_key(text).unwrap())
    }

    fn tracker_with(panel: &str, depart: &str, arrive: &str) -> Tracker {
        let mut t = Tracker::new();
        let parse = |s: &str| if s.is_empty() { None } else { combo(s) };
        t.assign([parse(panel), parse(depart), parse(arrive)]);
        t
    }

    fn texts(panel: &str, depart: &str, arrive: &str) -> [String; TRIGGER_COUNT] {
        [panel.to_string(), depart.to_string(), arrive.to_string()]
    }

    #[test]
    fn matches_only_the_exact_combination() {
        let f8 = parse_key("F8").unwrap();
        assert!(matches(&f8, 0x77, false, false, false));
        assert!(!matches(&f8, 0x77, true, false, false)); // an extra modifier
        assert!(!matches(&f8, 0x78, false, false, false)); // another key
        let cat = parse_key("Ctrl+Alt+T").unwrap();
        assert!(matches(&cat, 0x54, true, true, false));
        assert!(!matches(&cat, 0x54, true, false, false));
    }

    #[test]
    fn a_missing_or_extra_shift_does_not_match() {
        let shift_f9 = parse_key("Shift+F9").unwrap();
        assert!(matches(&shift_f9, 0x78, false, false, true));
        assert!(!matches(&shift_f9, 0x78, false, false, false));
        let f9 = parse_key("F9").unwrap();
        assert!(!matches(&f9, 0x78, false, false, true));
    }

    #[test]
    fn fires_the_trigger_of_the_pressed_key() {
        let mut t = tracker_with("F8", "Ctrl+Alt+1", "Ctrl+Alt+2");
        assert_eq!(t.handle(WM_KEYDOWN, 0x77, || NONE), Some(Trigger::Panel));
        assert_eq!(
            t.handle(WM_SYSKEYDOWN, 0x31, || CTRL_ALT),
            Some(Trigger::Depart)
        );
        assert_eq!(
            t.handle(WM_SYSKEYDOWN, 0x32, || CTRL_ALT),
            Some(Trigger::Arrive)
        );
    }

    #[test]
    fn the_wrong_modifiers_do_not_fire() {
        let mut t = tracker_with("F8", "", "");
        let ctrl = Modifiers {
            ctrl: true,
            alt: false,
            shift: false,
        };
        assert_eq!(t.handle(WM_KEYDOWN, 0x77, || ctrl), None);
    }

    #[test]
    fn auto_repeat_fires_once_and_a_release_re_arms_the_key() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(t.handle(WM_KEYDOWN, 0x77, || NONE), Some(Trigger::Panel));
        assert_eq!(t.handle(WM_KEYDOWN, 0x77, || NONE), None);
        assert_eq!(t.handle(WM_KEYDOWN, 0x77, || NONE), None);
        assert_eq!(t.handle(WM_KEYUP, 0x77, || NONE), None);
        assert_eq!(t.handle(WM_KEYDOWN, 0x77, || NONE), Some(Trigger::Panel));
    }

    #[test]
    fn releasing_the_modifier_first_still_re_arms_the_key() {
        let mut t = tracker_with("Ctrl+Alt+T", "", "");
        assert_eq!(
            t.handle(WM_SYSKEYDOWN, 0x54, || CTRL_ALT),
            Some(Trigger::Panel)
        );
        assert_eq!(t.handle(WM_SYSKEYUP, 0x54, || NONE), None);
        assert_eq!(
            t.handle(WM_SYSKEYDOWN, 0x54, || CTRL_ALT),
            Some(Trigger::Panel)
        );
    }

    #[test]
    fn a_key_held_before_its_modifiers_does_not_fire_on_repeat() {
        let mut t = tracker_with("Ctrl+Alt+T", "", "");
        // T is held on its own and starts repeating; Ctrl+Alt joins later.
        assert_eq!(t.handle(WM_KEYDOWN, 0x54, || NONE), None);
        assert_eq!(t.handle(WM_SYSKEYDOWN, 0x54, || CTRL_ALT), None);
    }

    #[test]
    fn a_trigger_with_no_key_never_fires() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(t.handle(WM_KEYDOWN, 0x78, || NONE), None);
        assert!(t.any_assigned());
        assert!(!tracker_with("", "", "").any_assigned());
    }

    #[test]
    fn only_key_messages_count() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(t.handle(0x0102, 0x77, || NONE), None); // WM_CHAR
        assert_eq!(t.handle(0x0200, 0x77, || NONE), None); // WM_MOUSEMOVE
        assert_eq!(t.held, [false; TRIGGER_COUNT]);
    }

    #[test]
    fn reassigning_forgets_the_held_state() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(t.handle(WM_KEYDOWN, 0x77, || NONE), Some(Trigger::Panel));
        t.assign([combo("F9"), None, None]);
        assert_eq!(t.handle(WM_KEYDOWN, 0x77, || NONE), None); // F8 is not assigned any more
        assert_eq!(t.handle(WM_KEYDOWN, 0x78, || NONE), Some(Trigger::Panel));
    }

    #[test]
    fn two_triggers_on_one_key_fire_only_the_first() {
        let mut t = tracker_with("F8", "F8", "");
        assert_eq!(t.handle(WM_KEYDOWN, 0x77, || NONE), Some(Trigger::Panel));
        assert_eq!(t.handle(WM_KEYDOWN, 0x77, || NONE), None);
    }

    // PRIVACY: the hook looks only at the assigned keys. For every other key it must not read the
    // modifier state, must not remember the key and must not fire.
    #[test]
    fn every_unassigned_key_is_dropped_without_being_looked_at() {
        let mut t = tracker_with("F8", "Ctrl+Alt+T", "");
        let reads = Cell::new(0u32);
        for vk in 0u32..=0xFF {
            if vk == 0x77 || vk == 0x54 {
                continue;
            }
            for msg in [WM_KEYDOWN, WM_SYSKEYDOWN, WM_KEYUP, WM_SYSKEYUP] {
                let fired = t.handle(msg, vk, || {
                    reads.set(reads.get() + 1);
                    CTRL_ALT
                });
                assert_eq!(fired, None, "vk {vk:#x} msg {msg:#x}");
            }
        }
        assert_eq!(
            reads.get(),
            0,
            "the modifier state was read for an unassigned key"
        );
        assert_eq!(
            t.held, [false; TRIGGER_COUNT],
            "an unassigned key was remembered"
        );
    }

    #[test]
    fn nothing_is_read_or_fired_while_no_key_is_assigned() {
        let mut t = tracker_with("", "", "");
        let reads = Cell::new(0u32);
        for vk in 0u32..=0xFF {
            let fired = t.handle(WM_KEYDOWN, vk, || {
                reads.set(reads.get() + 1);
                CTRL_ALT
            });
            assert_eq!(fired, None);
        }
        assert_eq!(reads.get(), 0);
        assert_eq!(t.held, [false; TRIGGER_COUNT]);
    }

    #[test]
    fn the_modifier_state_is_read_once_per_assigned_key_press() {
        let mut t = tracker_with("F8", "Ctrl+F8", "");
        let reads = Cell::new(0u32);
        t.handle(WM_KEYDOWN, 0x77, || {
            reads.set(reads.get() + 1);
            NONE
        });
        assert_eq!(reads.get(), 1);
    }

    // Installs the real hook for a moment, with nothing assigned: the procedure reads nothing
    // while the tracker is empty. Checks that the thread starts, takes WM_QUIT and ends.
    #[cfg(windows)]
    #[test]
    fn the_hook_thread_installs_and_ends_on_request() {
        let hook = sys::HookThread::start().expect("the hook should install");
        hook.request_stop()
            .expect("WM_QUIT should reach the hook thread");
        hook.join();
    }

    #[test]
    fn blank_texts_are_not_assigned_and_not_errors() {
        let (combos, outcome) = parse_assignments(&texts("", "   ", ""));
        assert_eq!(combos, [None; TRIGGER_COUNT]);
        assert_eq!(outcome, vec![None, None, None]);
    }

    #[test]
    fn every_trigger_gets_its_own_outcome() {
        let (combos, outcome) = parse_assignments(&texts("F8", "T", "Banana"));
        assert_eq!(combos[0], combo("F8"));
        assert_eq!(combos[1], None);
        assert_eq!(combos[2], None);
        assert_eq!(outcome[0], None);
        assert_eq!(outcome[1], Some("нужен Ctrl или Alt".to_string()));
        assert!(
            outcome[2]
                .as_deref()
                .is_some_and(|reason| reason.contains("Banana"))
        );
    }

    #[test]
    fn triggers_have_stable_names_and_a_payload_with_only_the_name() {
        let names: Vec<&str> = Trigger::ALL.iter().map(|t| t.name()).collect();
        assert_eq!(names, ["panel", "depart", "arrive"]);
        let json = serde_json::to_string(&TriggerPayload {
            name: Trigger::Arrive.name(),
        })
        .unwrap();
        assert_eq!(json, r#"{"name":"arrive"}"#);
    }
}
