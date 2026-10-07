//! Optional trigger keys ("panel", "depart", "arrive"), caught by a low-level keyboard hook.
//! Windows global hotkeys never fire while the game is in the foreground; a low-level hook does.
//!
//! PRIVACY — the hook procedure looks only at the keys that are assigned right now:
//! - `Tracker::handle` is plain data in, data out: no logging, no I/O, no clock (the time is a
//!   parameter). For a key that is not assigned it returns before it reads anything else (not
//!   even the modifier state) and stores nothing. The tests below pin that down.
//! - A trigger is logged by its name (`panel`, `depart`, `arrive`), never by its key. That holds
//!   for a fired trigger and for a press that was discarded as an auto-repeat.
//! - The hook procedure never swallows an event: it always ends in `CallNextHookEx`, so the game
//!   receives every key as well.
//!
//! One press must fire once, though the key sends auto-repeat key-downs while it is held. The
//! tracker tells a repeat from a new press by the key-up, and, because a key-up can get lost
//! (the focus moves to our panel while the key is still down), also by time: see
//! `REPEAT_WINDOW_MS`.
//!
//! The hook lives only while at least one key is assigned. It runs on its own thread with a
//! message loop, at a raised priority. The procedure does nothing slow: what it found out (a fired
//! trigger, a discarded repeat) is handed to another thread that logs it and emits the event to the
//! webview.
//!
//! Windows silently removes a low-level hook whose thread answered too late. So every
//! `set_trigger_keys` that leaves a key assigned installs the hook afresh (`refresh_hook`): saving
//! the key in the settings repairs a hook that was dropped.

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

/// What the hook procedure found out about one key message. It is handed to another thread that
/// logs it and (for a fired trigger) tells the webview: the procedure itself does no I/O.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Event {
    Fired(Trigger),
    /// A key-down of the combination was dropped as an auto-repeat of the press before it.
    RepeatDiscarded(Trigger),
}

/// How long a held key may stay silent before it is taken for released. Auto-repeat keeps sending
/// key-downs: the first repeat comes after the keyboard delay (one second at most), the next ones
/// faster. So a key whose last key-down is older than this has been let go, even when its key-up
/// was never seen. A key-up can go missing: in the game a trigger moves the focus to our panel
/// while the key is still down, and the release is then not seen as an ordinary key-up.
const REPEAT_WINDOW_MS: u64 = 1100;

/// A key of an assigned trigger that is taken for down.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Held {
    /// Monotonic time of the latest key-down of this key that was seen: the press or a repeat.
    last_down_ms: u64,
    /// A discarded repeat of this press has been reported already.
    repeat_reported: bool,
}

/// The assigned combinations and which of their keys are down.
struct Tracker {
    combos: [Option<KeyCombo>; TRIGGER_COUNT],
    /// The key of this trigger is taken for down. Auto-repeat sends further key-downs; one press
    /// must fire once. Set by any key-down of the assigned key, matching modifiers or not, so that
    /// joining Ctrl+Alt to an already held key does not fire it. It ends with a key-up (the
    /// ordinary or the system message), with a silence longer than `REPEAT_WINDOW_MS` (noticed at
    /// the next key-down), or with `assign`.
    held: [Option<Held>; TRIGGER_COUNT],
}

impl Tracker {
    const fn new() -> Self {
        Tracker {
            combos: [None; TRIGGER_COUNT],
            held: [None; TRIGGER_COUNT],
        }
    }

    fn assign(&mut self, combos: [Option<KeyCombo>; TRIGGER_COUNT]) {
        self.combos = combos;
        self.held = [None; TRIGGER_COUNT];
    }

    fn any_assigned(&self) -> bool {
        self.combos.iter().any(Option::is_some)
    }

    /// Looks at one keyboard message. `now_ms` is a monotonic time in milliseconds; the tracker
    /// itself never reads a clock. `modifiers` is called at most once, and only when `vk` is an
    /// assigned key. Returns what is worth telling: the trigger to fire (the first one if several
    /// share the combination), or, once per press, that a repeat of a combination was discarded.
    fn handle(
        &mut self,
        msg: u32,
        vk: u32,
        now_ms: u64,
        modifiers: impl Fn() -> Modifiers,
    ) -> Option<Event> {
        let Tracker { combos, held } = self;
        match msg {
            WM_KEYDOWN | WM_SYSKEYDOWN => {
                let mut read: Option<Modifiers> = None;
                let mut event = None;
                for (i, slot) in combos.iter().enumerate() {
                    let Some(combo) = slot else { continue };
                    if combo.vk != vk {
                        continue;
                    }
                    // A repeat of a press that is still going on; anything else is a new press.
                    let repeat_of = held[i]
                        .filter(|h| now_ms.saturating_sub(h.last_down_ms) <= REPEAT_WINDOW_MS);
                    // Every key-down refreshes the time, so a key held for long never expires.
                    let mut state = Held {
                        last_down_ms: now_ms,
                        repeat_reported: repeat_of.is_some_and(|h| h.repeat_reported),
                    };
                    if event.is_none() && !state.repeat_reported {
                        let m = *read.get_or_insert_with(&modifiers);
                        if matches(combo, vk, m.ctrl, m.alt, m.shift) {
                            let trigger = Trigger::ALL[i];
                            if repeat_of.is_none() {
                                event = Some(Event::Fired(trigger));
                            } else {
                                // Reported once; the next repeats of this press stay silent.
                                state.repeat_reported = true;
                                event = Some(Event::RepeatDiscarded(trigger));
                            }
                        }
                    }
                    held[i] = Some(state);
                }
                event
            }
            WM_KEYUP | WM_SYSKEYUP => {
                for (i, slot) in combos.iter().enumerate() {
                    if slot.is_some_and(|combo| combo.vk == vk) {
                        held[i] = None;
                    }
                }
                None
            }
            _ => None,
        }
    }
}

static TRACKER: Mutex<Tracker> = Mutex::new(Tracker::new());
/// Events of the tracker, from the hook thread to the thread that logs and emits them.
static SINK: OnceLock<mpsc::Sender<Event>> = OnceLock::new();

fn tracker() -> MutexGuard<'static, Tracker> {
    // The tracker holds plain data that is valid at every point, so a poisoned lock is still usable.
    TRACKER.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What the hook procedure does with one keyboard message.
#[cfg(windows)]
fn on_key_message(msg: u32, vk: u32) {
    let event = tracker().handle(msg, vk, sys::monotonic_ms(), sys::modifiers_held);
    if let Some(event) = event
        && let Some(tx) = SINK.get()
    {
        let _ = tx.send(event);
    }
}

#[cfg(windows)]
mod sys {
    use std::sync::{OnceLock, mpsc};
    use std::thread::{self, JoinHandle};
    use std::time::Instant;

    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::{
        GetCurrentThread, GetCurrentThreadId, SetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL,
    };
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

        /// Whether the thread has ended (normally or not): its hook is gone then.
        pub fn is_finished(&self) -> bool {
            self.join.is_finished()
        }

        /// A handle whose thread cannot be reached by `request_stop` (there is no thread with that
        /// id), around a thread of the caller's.
        #[cfg(test)]
        pub fn unreachable(join: JoinHandle<()>) -> HookThread {
            HookThread {
                thread_id: u32::MAX,
                join,
            }
        }

        /// Asks the message loop to end; the thread then removes the hook. A thread that has
        /// ended already needs nothing, and its id must not be posted to: Windows may have given
        /// it to some other thread by now.
        pub fn request_stop(&self) -> Result<(), String> {
            if self.is_finished() {
                return Ok(());
            }
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

    /// Milliseconds on a monotonic clock, counted from the first call. A time, not a key reading:
    /// it says nothing about which key it is asked for.
    pub fn monotonic_ms() -> u64 {
        static START: OnceLock<Instant> = OnceLock::new();
        u64::try_from(START.get_or_init(Instant::now).elapsed().as_millis()).unwrap_or(u64::MAX)
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

    /// Raises the priority of the CALLING thread, and of no other. Windows drops a low-level hook whose
    /// thread does not answer within its time limit, without telling the application; next to a game that
    /// keeps every core busy a thread of normal priority can be late. This thread does next to nothing
    /// (it sleeps in `GetMessageW` and runs the procedure for a key), so the priority costs nothing.
    pub fn raise_own_priority() -> Result<(), String> {
        // SAFETY: `GetCurrentThread` is a pseudo handle for the calling thread (nothing to close).
        unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL) }
            .map_err(|err| format!("SetThreadPriority failed: {err}"))
    }

    fn run(ready: mpsc::SyncSender<Result<u32, String>>) {
        if let Err(err) = raise_own_priority() {
            // Not fatal: the hook works at the normal priority, only more easily dropped.
            log::warn!("[hook] cannot raise the priority of the hook thread: {err}");
        }
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
        pub fn is_finished(&self) -> bool {
            true
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

/// Thread that logs what the hook found out and tells the webview about every fired trigger.
/// Started once, with the first hook.
fn ensure_event_thread(app: &AppHandle) -> Result<(), String> {
    if SINK.get().is_some() {
        return Ok(());
    }
    let (tx, rx) = mpsc::channel::<Event>();
    let app = app.clone();
    thread::Builder::new()
        .name("input-trigger".into())
        .spawn(move || {
            for event in rx {
                match event {
                    Event::Fired(trigger) => {
                        log::info!("[hook] trigger fired: {}", trigger.name());
                        let payload = TriggerPayload {
                            name: trigger.name(),
                        };
                        if let Err(err) = app.emit(TRIGGER_EVENT, payload) {
                            log::error!("[hook] cannot emit {TRIGGER_EVENT}: {err}");
                        }
                    }
                    Event::RepeatDiscarded(trigger) => {
                        log::debug!(
                            "[hook] trigger {}: key-down discarded as a repeat",
                            trigger.name()
                        );
                    }
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

/// Takes the hook thread out of the slot and ends it. The slot is empty afterwards in every case:
/// a thread left in it (one that died, or that cannot be stopped) would block every later install.
/// A thread that cannot be stopped and has not ended is not waited for (it might never end); it
/// stays installed with nothing assigned, so it fires nothing, and a new hook next to it is fine
/// because the tracker lets a key fire only once.
fn remove_hook(slot: &mut Option<sys::HookThread>) {
    let Some(thread) = slot.take() else { return };
    match thread.request_stop() {
        Ok(()) => {
            thread.join();
            log::info!("[hook] keyboard hook removed");
        }
        Err(reason) => {
            log::error!("[hook] cannot remove the keyboard hook: {reason}");
            if thread.is_finished() {
                thread.join();
            }
        }
    }
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

    // Said in the log, though `refresh_hook` takes the thread out in any case.
    if hook.as_ref().is_some_and(sys::HookThread::is_finished) {
        log::warn!("[hook] the hook thread had ended on its own");
    }

    let wanted = tracker().any_assigned();
    let installed = refresh_hook(&mut hook, wanted, || {
        ensure_event_thread(app).and_then(|()| sys::HookThread::start())
    });
    if let Err(reason) = installed {
        log::error!("[hook] cannot install the keyboard hook: {reason}");
        tracker().assign([None; TRIGGER_COUNT]);
        return Err(reason);
    }
    Ok(outcome)
}

/// Brings the hook in `slot` in line with what is wanted: nothing, when no key is assigned, otherwise a
/// NEW hook, installed by `install`.
///
/// A hook that is already in the slot is taken out first, even when it looks fine. Windows removes a
/// low-level hook whose thread answered too late, without telling the application; the thread lives on
/// and nothing in the slot shows the hook is gone. Leaving "the installed hook" alone would leave the
/// keys dead until the program restarts; taking it out and installing a new one is the repair. The
/// whole change is made under the controller's lock (the caller holds `slot`), so removing and
/// installing never overlap with another change.
///
/// If `install` fails, the slot is empty afterwards and the reason is returned.
fn refresh_hook(
    slot: &mut Option<sys::HookThread>,
    wanted: bool,
    install: impl FnOnce() -> Result<sys::HookThread, String>,
) -> Result<(), String> {
    remove_hook(slot);
    if !wanted {
        return Ok(());
    }
    *slot = Some(install()?);
    log::info!("[hook] keyboard hook installed");
    Ok(())
}

/// Assigns the trigger keys and installs or removes the keyboard hook to match. An empty string
/// means "not assigned". Returns, for panel / depart / arrive, `None` or the reason the text
/// could not be used. Safe to call again with the same keys (a reloaded webview does): the hook is
/// then installed afresh.
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

    /// Everything the tests do with the tracker: the time is given in milliseconds, the modifiers
    /// as a plain value.
    fn press(t: &mut Tracker, msg: u32, vk: u32, now_ms: u64, m: Modifiers) -> Option<Event> {
        t.handle(msg, vk, now_ms, || m)
    }

    fn fired(trigger: Trigger) -> Option<Event> {
        Some(Event::Fired(trigger))
    }

    fn discarded(trigger: Trigger) -> Option<Event> {
        Some(Event::RepeatDiscarded(trigger))
    }

    fn nothing_held(t: &Tracker) -> bool {
        t.held.iter().all(Option::is_none)
    }

    #[test]
    fn fires_the_trigger_of_the_pressed_key() {
        let mut t = tracker_with("F8", "Ctrl+Alt+1", "Ctrl+Alt+2");
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 0, NONE),
            fired(Trigger::Panel)
        );
        assert_eq!(
            press(&mut t, WM_SYSKEYDOWN, 0x31, 0, CTRL_ALT),
            fired(Trigger::Depart)
        );
        assert_eq!(
            press(&mut t, WM_SYSKEYDOWN, 0x32, 0, CTRL_ALT),
            fired(Trigger::Arrive)
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
        assert_eq!(press(&mut t, WM_KEYDOWN, 0x77, 0, ctrl), None);
    }

    #[test]
    fn auto_repeat_fires_once_and_a_release_re_arms_the_key() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 0, NONE),
            fired(Trigger::Panel)
        );
        // The first repeat is reported, the next ones are not (see the throttle tests below).
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 500, NONE),
            discarded(Trigger::Panel)
        );
        assert_eq!(press(&mut t, WM_KEYDOWN, 0x77, 530, NONE), None);
        assert_eq!(press(&mut t, WM_KEYUP, 0x77, 550, NONE), None);
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 600, NONE),
            fired(Trigger::Panel)
        );
    }

    #[test]
    fn releasing_the_modifier_first_still_re_arms_the_key() {
        let mut t = tracker_with("Ctrl+Alt+T", "", "");
        assert_eq!(
            press(&mut t, WM_SYSKEYDOWN, 0x54, 0, CTRL_ALT),
            fired(Trigger::Panel)
        );
        assert_eq!(press(&mut t, WM_SYSKEYUP, 0x54, 50, NONE), None);
        assert_eq!(
            press(&mut t, WM_SYSKEYDOWN, 0x54, 100, CTRL_ALT),
            fired(Trigger::Panel)
        );
    }

    #[test]
    fn a_key_held_before_its_modifiers_does_not_fire_on_repeat() {
        let mut t = tracker_with("Ctrl+Alt+T", "", "");
        // T is held on its own and starts repeating; Ctrl+Alt joins later.
        assert_eq!(press(&mut t, WM_KEYDOWN, 0x54, 0, NONE), None);
        assert_eq!(
            press(&mut t, WM_SYSKEYDOWN, 0x54, 30, CTRL_ALT),
            discarded(Trigger::Panel)
        );
    }

    #[test]
    fn a_trigger_with_no_key_never_fires() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(press(&mut t, WM_KEYDOWN, 0x78, 0, NONE), None);
        assert!(t.any_assigned());
        assert!(!tracker_with("", "", "").any_assigned());
    }

    #[test]
    fn only_key_messages_count() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(press(&mut t, 0x0102, 0x77, 0, NONE), None); // WM_CHAR
        assert_eq!(press(&mut t, 0x0200, 0x77, 0, NONE), None); // WM_MOUSEMOVE
        assert!(nothing_held(&t));
    }

    #[test]
    fn reassigning_forgets_the_held_state() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 0, NONE),
            fired(Trigger::Panel)
        );
        t.assign([combo("F9"), None, None]);
        assert_eq!(press(&mut t, WM_KEYDOWN, 0x77, 10, NONE), None); // F8 is not assigned any more
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x78, 20, NONE),
            fired(Trigger::Panel)
        );
    }

    #[test]
    fn reassigning_the_same_key_forgets_that_it_was_held() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 0, NONE),
            fired(Trigger::Panel)
        );
        // The key-up never came; the keys are replaced a moment later (a reloaded webview).
        t.assign([combo("F8"), None, None]);
        assert!(nothing_held(&t));
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 10, NONE),
            fired(Trigger::Panel)
        );
    }

    #[test]
    fn two_triggers_on_one_key_fire_only_the_first() {
        let mut t = tracker_with("F8", "F8", "");
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 0, NONE),
            fired(Trigger::Panel)
        );
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 30, NONE),
            discarded(Trigger::Panel)
        );
    }

    // A release that is seen clears the held state, as the ordinary and as the system message
    // (Windows sends the system one while Alt is down, or when no window has the focus).
    #[test]
    fn a_key_up_re_arms_the_key_whether_it_is_the_ordinary_or_the_system_message() {
        for up in [WM_KEYUP, WM_SYSKEYUP] {
            let mut t = tracker_with("F8", "", "");
            assert_eq!(
                press(&mut t, WM_KEYDOWN, 0x77, 0, NONE),
                fired(Trigger::Panel)
            );
            assert_eq!(press(&mut t, up, 0x77, 80, NONE), None, "msg {up:#x}");
            // A new press right after the release: far inside the repeat window, still new.
            assert_eq!(
                press(&mut t, WM_KEYDOWN, 0x77, 120, NONE),
                fired(Trigger::Panel),
                "msg {up:#x}"
            );
        }
    }

    // The key-up of a press can be lost (the focus moved from the game to our panel while the key
    // was down). Auto-repeat comes at most about a second after the key-down, so a longer silence
    // means the key was released.
    #[test]
    fn a_key_down_after_a_silence_longer_than_the_repeat_window_is_a_new_press() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 0, NONE),
            fired(Trigger::Panel)
        );
        // No key-up was seen. Exactly the window is still a repeat, one millisecond more is not.
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 1100, NONE),
            discarded(Trigger::Panel)
        );
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 2201, NONE),
            fired(Trigger::Panel)
        );
    }

    #[test]
    fn the_silence_is_counted_from_the_last_key_down_seen_not_from_the_first() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 0, NONE),
            fired(Trigger::Panel)
        );
        // 1500 ms after the first key-down, but only 600 ms after the last one: still a repeat.
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 900, NONE),
            discarded(Trigger::Panel)
        );
        assert_eq!(press(&mut t, WM_KEYDOWN, 0x77, 1500, NONE), None);
        // And a real gap after that is a new press.
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 2700, NONE),
            fired(Trigger::Panel)
        );
    }

    #[test]
    fn presses_a_second_or_two_apart_all_fire_even_when_no_key_up_is_ever_seen() {
        let mut t = tracker_with("F8", "", "");
        for i in 0..10u64 {
            // Ten presses 1.5 s apart, none of them ever followed by a key-up.
            assert_eq!(
                press(&mut t, WM_KEYDOWN, 0x77, i * 1500, NONE),
                fired(Trigger::Panel),
                "press {i}"
            );
        }
    }

    #[test]
    fn auto_repeat_is_still_suppressed() {
        // Every 30 ms, and the first repeat after the 500 ms and the 1000 ms keyboard delays.
        for (first_repeat, interval) in [(30u64, 30u64), (500, 33), (1000, 33)] {
            let mut t = tracker_with("F8", "", "");
            let mut fires = 0;
            let mut count = |event: Option<Event>| {
                if event == fired(Trigger::Panel) {
                    fires += 1;
                }
            };
            count(press(&mut t, WM_KEYDOWN, 0x77, 0, NONE));
            let mut now = first_repeat;
            while now <= first_repeat + 3000 {
                count(press(&mut t, WM_KEYDOWN, 0x77, now, NONE));
                now += interval;
            }
            assert_eq!(
                fires, 1,
                "first repeat at {first_repeat} ms, then every {interval} ms"
            );
        }
    }

    #[test]
    fn a_key_held_for_ten_seconds_fires_once() {
        let mut t = tracker_with("F8", "", "");
        let mut fires = 0;
        let mut now = 0u64;
        let mut interval = 500; // the keyboard delay, then the repeat rate
        while now <= 10_000 {
            if press(&mut t, WM_KEYDOWN, 0x77, now, NONE) == fired(Trigger::Panel) {
                fires += 1;
            }
            now += interval;
            interval = 33;
        }
        assert_eq!(fires, 1);
        // Released at last; the next press is a new one.
        assert_eq!(press(&mut t, WM_KEYUP, 0x77, 10_050, NONE), None);
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 10_100, NONE),
            fired(Trigger::Panel)
        );
    }

    // The debug line for a discarded press: once per press, by trigger, for the combination only.
    #[test]
    fn a_discarded_repeat_is_reported_once_per_press() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 0, NONE),
            fired(Trigger::Panel)
        );
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 500, NONE),
            discarded(Trigger::Panel)
        );
        for now in (533..=3000).step_by(33) {
            assert_eq!(
                press(&mut t, WM_KEYDOWN, 0x77, now, NONE),
                None,
                "at {now} ms"
            );
        }
        // A release, a new press, and its repeat is reported again.
        assert_eq!(press(&mut t, WM_KEYUP, 0x77, 3100, NONE), None);
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 3200, NONE),
            fired(Trigger::Panel)
        );
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 3700, NONE),
            discarded(Trigger::Panel)
        );
    }

    #[test]
    fn the_expiry_of_a_lost_key_up_starts_a_new_press_with_its_own_report() {
        let mut t = tracker_with("F8", "", "");
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 0, NONE),
            fired(Trigger::Panel)
        );
        // The user presses again 400 ms later; the release of the first press was lost.
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 400, NONE),
            discarded(Trigger::Panel)
        );
        assert_eq!(press(&mut t, WM_KEYDOWN, 0x77, 800, NONE), None);
        // A second or two later the key is taken for released: a new press fires, and its own
        // discarded repeat is reported again.
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 2500, NONE),
            fired(Trigger::Panel)
        );
        assert_eq!(
            press(&mut t, WM_KEYDOWN, 0x77, 2900, NONE),
            discarded(Trigger::Panel)
        );
    }

    #[test]
    fn a_repeat_of_another_combination_on_the_same_key_is_not_reported() {
        // Ctrl is held with F8, which is assigned without modifiers: that was never a panel press.
        let ctrl = Modifiers {
            ctrl: true,
            alt: false,
            shift: false,
        };
        let mut t = tracker_with("F8", "", "");
        assert_eq!(press(&mut t, WM_KEYDOWN, 0x77, 0, ctrl), None);
        assert_eq!(press(&mut t, WM_KEYDOWN, 0x77, 30, ctrl), None);
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
                // Twice, so that a repeat of an unassigned key would be reported if it were kept.
                for now in [0, 30] {
                    let event = t.handle(msg, vk, now, || {
                        reads.set(reads.get() + 1);
                        CTRL_ALT
                    });
                    assert_eq!(event, None, "vk {vk:#x} msg {msg:#x}");
                }
            }
        }
        assert_eq!(
            reads.get(),
            0,
            "the modifier state was read for an unassigned key"
        );
        assert!(nothing_held(&t), "an unassigned key was remembered");
    }

    #[test]
    fn nothing_is_read_or_fired_while_no_key_is_assigned() {
        let mut t = tracker_with("", "", "");
        let reads = Cell::new(0u32);
        for vk in 0u32..=0xFF {
            let event = t.handle(WM_KEYDOWN, vk, u64::from(vk), || {
                reads.set(reads.get() + 1);
                CTRL_ALT
            });
            assert_eq!(event, None);
        }
        assert_eq!(reads.get(), 0);
        assert!(nothing_held(&t));
    }

    #[test]
    fn the_modifier_state_is_read_at_most_once_per_message() {
        let mut t = tracker_with("F8", "Ctrl+F8", "");
        let reads = Cell::new(0u32);
        let mut read_once = |now_ms| {
            reads.set(0);
            t.handle(WM_KEYDOWN, 0x77, now_ms, || {
                reads.set(reads.get() + 1);
                NONE
            });
            reads.get()
        };
        assert_eq!(read_once(0), 1); // the press
        assert_eq!(read_once(30), 1); // the first repeat, to see whether it is worth a report
        assert_eq!(read_once(60), 1);
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

    #[cfg(windows)]
    fn wait_until_finished(hook: &sys::HookThread) {
        let started = std::time::Instant::now();
        while !hook.is_finished() {
            assert!(
                started.elapsed().as_secs() < 5,
                "the hook thread did not end"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    #[cfg(windows)]
    #[test]
    fn removing_the_hook_empties_the_slot() {
        let mut slot = Some(sys::HookThread::start().expect("the hook should install"));
        remove_hook(&mut slot);
        assert!(slot.is_none());
    }

    // The hook thread can end on its own (its message loop failed). The slot must not keep it:
    // a dead thread left there blocks every later install and every later removal.
    #[cfg(windows)]
    #[test]
    fn a_hook_thread_that_already_ended_is_cleared_from_the_slot() {
        let hook = sys::HookThread::start().expect("the hook should install");
        hook.request_stop()
            .expect("WM_QUIT should reach the hook thread");
        wait_until_finished(&hook);
        let mut slot = Some(hook);
        remove_hook(&mut slot);
        assert!(slot.is_none());
    }

    // `request_stop` itself can fail. The slot is cleared anyway, and the thread is not waited
    // for, because it may never end.
    #[cfg(windows)]
    #[test]
    fn a_hook_thread_that_cannot_be_stopped_is_cleared_from_the_slot_without_waiting() {
        let (release, parked) = mpsc::channel::<()>();
        let join = std::thread::spawn(move || {
            let _ = parked.recv(); // lives until `release` is dropped
        });
        let mut slot = Some(sys::HookThread::unreachable(join));
        remove_hook(&mut slot);
        assert!(slot.is_none());
        drop(release);
    }

    // The hook that is in the slot can be one that Windows has removed without telling anyone (its
    // thread answered too late), and nothing in the slot shows it. So whenever keys are applied, a hook
    // is taken out and a new one put in, never "there is one, leave it".

    #[cfg(windows)]
    #[test]
    fn keys_applied_with_no_hook_in_place_install_one() {
        let mut slot = None;
        let installs = Cell::new(0);
        refresh_hook(&mut slot, true, || {
            installs.set(installs.get() + 1);
            sys::HookThread::start()
        })
        .expect("the hook should install");
        assert_eq!(installs.get(), 1);
        assert!(slot.is_some());
        remove_hook(&mut slot);
    }

    #[cfg(windows)]
    #[test]
    fn keys_applied_with_a_hook_in_place_install_a_new_one() {
        let mut slot = Some(sys::HookThread::start().expect("the hook should install"));
        for round in 1..=3 {
            let installs = Cell::new(0);
            refresh_hook(&mut slot, true, || {
                installs.set(installs.get() + 1);
                sys::HookThread::start()
            })
            .expect("the hook should install");
            assert_eq!(installs.get(), 1, "round {round}");
            assert!(slot.as_ref().is_some_and(|hook| !hook.is_finished()));
        }
        remove_hook(&mut slot);
        assert!(slot.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn keys_applied_over_a_hook_thread_that_ended_install_a_new_one() {
        let hook = sys::HookThread::start().expect("the hook should install");
        hook.request_stop()
            .expect("WM_QUIT should reach the hook thread");
        wait_until_finished(&hook);
        let mut slot = Some(hook);
        refresh_hook(&mut slot, true, sys::HookThread::start).expect("the hook should install");
        assert!(slot.as_ref().is_some_and(|hook| !hook.is_finished()));
        remove_hook(&mut slot);
    }

    #[cfg(windows)]
    #[test]
    fn keys_applied_over_a_hook_thread_that_cannot_be_stopped_still_install_a_new_one() {
        let (release, parked) = mpsc::channel::<()>();
        let join = std::thread::spawn(move || {
            let _ = parked.recv();
        });
        let mut slot = Some(sys::HookThread::unreachable(join));
        refresh_hook(&mut slot, true, sys::HookThread::start).expect("the hook should install");
        assert!(slot.as_ref().is_some_and(|hook| !hook.is_finished()));
        remove_hook(&mut slot);
        drop(release);
    }

    #[test]
    fn no_keys_applied_leave_no_hook_and_install_nothing() {
        let mut slot = None;
        refresh_hook(&mut slot, false, || -> Result<sys::HookThread, String> {
            panic!("nothing is wanted, nothing may be installed")
        })
        .expect("nothing to do");
        assert!(slot.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn no_keys_applied_remove_the_hook_that_is_in_place() {
        let mut slot = Some(sys::HookThread::start().expect("the hook should install"));
        refresh_hook(&mut slot, false, || -> Result<sys::HookThread, String> {
            panic!("nothing is wanted, nothing may be installed")
        })
        .expect("nothing to do");
        assert!(slot.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn a_hook_that_cannot_be_installed_is_reported_and_leaves_the_slot_empty() {
        let mut slot = Some(sys::HookThread::start().expect("the hook should install"));
        let result = refresh_hook(&mut slot, true, || Err("no hook for you".to_string()));
        assert_eq!(result, Err("no hook for you".to_string()));
        assert!(slot.is_none());
    }

    // The hook thread raises its own priority (and no other thread's): a late answer makes Windows
    // drop a low-level hook, and next to a game that keeps every core busy a thread of normal priority
    // can be late.
    #[cfg(windows)]
    #[test]
    fn the_hook_thread_raises_its_own_priority_only() {
        use windows::Win32::System::Threading::{
            GetCurrentThread, GetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL,
        };
        fn own() -> i32 {
            // SAFETY: plain query on the calling thread's pseudo handle.
            unsafe { GetThreadPriority(GetCurrentThread()) }
        }
        let before = own();
        let raised = std::thread::spawn(|| {
            sys::raise_own_priority().expect("the priority should be raised");
            own()
        })
        .join()
        .unwrap();
        assert_eq!(raised, THREAD_PRIORITY_TIME_CRITICAL.0);
        assert_ne!(before, THREAD_PRIORITY_TIME_CRITICAL.0);
        assert_eq!(own(), before);
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
