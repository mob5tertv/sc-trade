use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use log::LevelFilter;
use tauri::{Wry, plugin::TauriPlugin};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

const LOG_FILE_NAME: &str = "sctrade";
/// With this file next to the exe, the log is also written to a file next to the exe.
const PORTABLE_FLAG: &str = "portable.flag";
const PORTABLE_LOG_NAME: &str = "sc-trade";
const MAX_FILE_SIZE: u128 = 5_000_000;
// `KeepSome(n)` keeps `n` archives next to the active file, so 4 gives five log files in total.
const KEEP_FILES: usize = 4;

/// What the `portable.flag` next to the exe asks for, and whether it can be done.
#[derive(Debug, PartialEq, Eq)]
enum PortableLog {
    /// No `portable.flag`.
    Off,
    /// `portable.flag` is there and the log file can be opened: also log into this folder.
    On(PathBuf),
    /// `portable.flag` is there but the log file cannot be opened (a read-only or locked folder,
    /// say). The target is left out: the plugin opens its files while it is set up, and a file it
    /// cannot open would stop the whole app from starting.
    Unavailable { file: PathBuf, reason: String },
}

/// The folder of the running exe, where the flag files are looked for.
fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
}

/// Is `name` a file (not a folder) in `dir`? How every flag file next to the exe is recognised.
fn flag_in(dir: &Path, name: &str) -> bool {
    dir.join(name).is_file()
}

/// Is the flag file `name` next to the running exe? (`portable.flag` is read through `flag_in`, too.)
pub fn flag_next_to_exe(name: &str) -> bool {
    exe_dir().is_some_and(|dir| flag_in(&dir, name))
}

/// The portable log file in `dir`: the name the plugin gives it (`<name>.log`).
fn portable_log_file(dir: &Path) -> PathBuf {
    dir.join(format!("{PORTABLE_LOG_NAME}.log"))
}

/// Decides the portable log for the folder `exe_dir`: the flag must be a file there, and the log
/// file is opened the way the plugin opens it (created if missing, appended to) to see that it can be.
fn portable_log(exe_dir: &Path) -> PortableLog {
    if !flag_in(exe_dir, PORTABLE_FLAG) {
        return PortableLog::Off;
    }
    let file = portable_log_file(exe_dir);
    match OpenOptions::new().create(true).append(true).open(&file) {
        Ok(_) => PortableLog::On(exe_dir.to_path_buf()),
        Err(err) => PortableLog::Unavailable {
            file,
            reason: err.to_string(),
        },
    }
}

/// `portable_log` for the folder of the running exe, decided once: `plugin()` and
/// `announce_portable_log()` must agree.
fn running_portable_log() -> &'static PortableLog {
    static DECISION: OnceLock<PortableLog> = OnceLock::new();
    DECISION.get_or_init(|| {
        exe_dir()
            .map(|dir| portable_log(&dir))
            .unwrap_or(PortableLog::Off)
    })
}

/// The crate of this application (`sc_trade_lib`): the start of the target of every line it writes.
const OWN_CRATE: &str = env!("CARGO_CRATE_NAME");

/// Is `target` the module path `root`, or below it (`root::something`)? A name that merely starts with
/// the same letters is not.
fn is_under(target: &str, root: &str) -> bool {
    target
        .strip_prefix(root)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with("::"))
}

/// May a line of this target and level be written?
///
/// The application's own lines (its Rust crate, and the interface's lines, which the log plugin writes
/// with the target `webview` or `webview::<location>`) keep the level of the setting. Every other crate
/// (sqlx, h2, hyper, reqwest, tao, wry, the plugins) writes `info` and above only, whatever level is
/// chosen: at `debug` they would bury the log (nine of ten bytes) and put the player's proxy address in it
/// (`proxy(http://host:port/) intercepts ...` from reqwest).
///
/// The cap only ever takes lines away. What the application's own lines do at each level is decided
/// as before: the Rust ones by `log::set_max_level` (`set_log_level` below), which the `log` macros
/// check before a line is even built; the interface's by its own logger, which filters before it
/// sends (its lines come in through a plugin command that does not look at that level).
fn passes_third_party_cap(target: &str, level: log::Level) -> bool {
    is_under(target, OWN_CRATE)
        || is_under(target, tauri_plugin_log::WEBVIEW_TARGET)
        || level <= log::Level::Info
}

/// `passes_third_party_cap` as the log plugin's filter.
fn third_party_cap(metadata: &log::Metadata) -> bool {
    passes_third_party_cap(metadata.target(), metadata.level())
}

/// Log plugin shared by Rust and the webview: one file in the app log directory
/// (`%LOCALAPPDATA%\com.sctrade.app\logs\sctrade.log`) plus stdout. With a `portable.flag` file
/// next to the exe, the same lines also go to `sc-trade.log` next to the exe.
/// Line format: `2026-01-31 14:05:09.123 [DEBUG] message`.
pub fn plugin() -> TauriPlugin<Wry> {
    let mut targets = vec![
        Target::new(TargetKind::LogDir {
            file_name: Some(LOG_FILE_NAME.into()),
        }),
        Target::new(TargetKind::Stdout),
    ];
    if let PortableLog::On(path) = running_portable_log() {
        targets.push(Target::new(TargetKind::Folder {
            path: path.clone(),
            file_name: Some(PORTABLE_LOG_NAME.into()),
        }));
    }
    tauri_plugin_log::Builder::new()
        .targets(targets)
        .max_file_size(MAX_FILE_SIZE)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_FILES))
        .level(LevelFilter::Debug)
        .filter(third_party_cap)
        // Must come before `format`: it also resets the formatter.
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .format(|out, message, record| {
            let now = TimezoneStrategy::UseLocal.get_now();
            out.finish(format_args!(
                "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03} [{}] {}",
                now.year(),
                now.month() as u8,
                now.day(),
                now.hour(),
                now.minute(),
                now.second(),
                now.millisecond(),
                record.level(),
                message
            ))
        })
        .build()
}

/// Says in the log whether the extra log file next to the exe is on, or why it is not. Call it
/// once the logger runs (the `setup` hook), because `plugin()` runs before there is a logger.
pub fn announce_portable_log() {
    match running_portable_log() {
        PortableLog::Off => {}
        PortableLog::On(dir) => log::info!(
            "[log] {PORTABLE_FLAG} found, the log is also written to {}",
            portable_log_file(dir).display()
        ),
        PortableLog::Unavailable { file, reason } => log::warn!(
            "[log] portable log unavailable: cannot open {}: {reason}",
            file.display()
        ),
    }
}

fn parse_level(level: &str) -> Result<LevelFilter, String> {
    match level {
        "debug" => Ok(LevelFilter::Debug),
        "info" => Ok(LevelFilter::Info),
        "warn" => Ok(LevelFilter::Warn),
        "error" => Ok(LevelFilter::Error),
        other => Err(format!("unknown log level: {other}")),
    }
}

/// Changes the level of Rust-side logging without a restart. The webview filters
/// its own entries before sending them (see `applyLogLevel` in the frontend). Lines of other crates
/// stay capped at `info` whatever is chosen (`passes_third_party_cap`).
#[tauri::command]
pub fn set_log_level(level: String) -> Result<(), String> {
    let filter = parse_level(&level)?;
    // Logged first so that a switch to a stricter level stays visible in the file.
    log::info!("[log] level set to {level}");
    log::set_max_level(filter);
    Ok(())
}

/// Writes panics with a backtrace to the log, then runs the default hook.
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        log::error!("[panic] {info}\n{backtrace}");
        default_hook(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_levels() {
        assert_eq!(parse_level("debug"), Ok(LevelFilter::Debug));
        assert_eq!(parse_level("info"), Ok(LevelFilter::Info));
        assert_eq!(parse_level("warn"), Ok(LevelFilter::Warn));
        assert_eq!(parse_level("error"), Ok(LevelFilter::Error));
    }

    #[test]
    fn rejects_unknown_level() {
        assert!(parse_level("trace").is_err());
        assert!(parse_level("").is_err());
    }

    /// Third-party crates that write to the log through the `log` crate in this application.
    const THIRD_PARTY: [&str; 8] = [
        "sqlx::query",
        "sqlx::sqlite::worker",
        "h2::codec::framed_write",
        "hyper_util::client::legacy::connect::http",
        "reqwest::connect",
        "tao::platform_impl::platform::event_loop",
        "wry::webview2",
        "tauri_plugin_sql::commands",
    ];

    #[test]
    fn the_applications_own_lines_keep_the_chosen_level() {
        // The target of a line written in this very module: the crate path of the application.
        assert!(passes_third_party_cap(module_path!(), log::Level::Debug));
        assert!(passes_third_party_cap("sc_trade_lib", log::Level::Debug));
        assert!(passes_third_party_cap(
            "sc_trade_lib::input_hook",
            log::Level::Debug
        ));
        assert!(passes_third_party_cap(
            "sc_trade_lib::input_hook",
            log::Level::Trace
        ));
    }

    #[test]
    fn the_interfaces_lines_keep_the_chosen_level() {
        // The interface's lines arrive with the target `webview`, or `webview::<location>`.
        assert!(passes_third_party_cap("webview", log::Level::Debug));
        assert!(passes_third_party_cap(
            "webview::http://tauri.localhost/assets/index-DwcJVy5X.js:1:2345",
            log::Level::Debug
        ));
        assert!(passes_third_party_cap(
            "webview::<anonymous>",
            log::Level::Debug
        ));
    }

    #[test]
    fn other_crates_do_not_write_debug_lines() {
        for target in THIRD_PARTY {
            assert!(
                !passes_third_party_cap(target, log::Level::Debug),
                "{target}"
            );
            assert!(
                !passes_third_party_cap(target, log::Level::Trace),
                "{target}"
            );
        }
    }

    #[test]
    fn other_crates_still_write_info_and_above() {
        for target in THIRD_PARTY {
            for level in [log::Level::Info, log::Level::Warn, log::Level::Error] {
                assert!(passes_third_party_cap(target, level), "{target} {level}");
            }
        }
    }

    #[test]
    fn a_name_that_only_starts_like_ours_is_not_ours() {
        assert!(!passes_third_party_cap(
            "sc_trade_lib_extra",
            log::Level::Debug
        ));
        assert!(!passes_third_party_cap(
            "sc_trade_libs::x",
            log::Level::Debug
        ));
        assert!(!passes_third_party_cap("webview2", log::Level::Debug));
        assert!(!passes_third_party_cap("webviewer::x", log::Level::Debug));
        assert!(!passes_third_party_cap("", log::Level::Debug));
        // The other way round: a third-party module path that merely contains our name.
        assert!(!passes_third_party_cap(
            "hyper::sc_trade_lib",
            log::Level::Debug
        ));
        assert!(!passes_third_party_cap("hyper::webview", log::Level::Debug));
    }

    /// A writer the test can read back after the logger has written to it.
    #[derive(Clone, Default)]
    struct Captured(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

    impl std::io::Write for Captured {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// Runs `lines` (target, level, text) through a logger configured the way `plugin()` configures
    /// its own: the level `debug`, then the third-party cap. Returns what was written.
    fn written(lines: &[(&str, log::Level, &str)]) -> String {
        use log::Log;
        let out = Captured::default();
        let (_, logger) = tauri_plugin_log::fern::Dispatch::new()
            .level(LevelFilter::Debug)
            .filter(third_party_cap)
            .chain(Box::new(out.clone()) as Box<dyn std::io::Write + Send>)
            .into_log();
        for (target, level, text) in lines {
            logger.log(
                &log::Record::builder()
                    .target(target)
                    .level(*level)
                    .args(format_args!("{text}"))
                    .build(),
            );
        }
        let bytes = out.0.lock().unwrap().clone();
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn the_logger_drops_third_party_debug_lines_and_keeps_the_rest() {
        let text = written(&[
            ("sc_trade_lib::input_hook", log::Level::Debug, "own debug"),
            (
                "webview::http://tauri.localhost/a.js:1:2",
                log::Level::Debug,
                "ui debug",
            ),
            (
                "reqwest::connect",
                log::Level::Debug,
                "proxy(http://host:8080/) intercepts",
            ),
            ("sqlx::query", log::Level::Debug, "INSERT INTO uex_prices"),
            ("h2::codec::framed_write", log::Level::Trace, "send frame"),
            ("reqwest::connect", log::Level::Info, "third-party info"),
            ("sqlx::query", log::Level::Warn, "slow statement"),
        ]);
        assert_eq!(
            text,
            "own debug\nui debug\nthird-party info\nslow statement\n"
        );
    }

    #[test]
    fn the_logger_never_writes_the_proxy_line() {
        let text = written(&[(
            "reqwest::connect",
            log::Level::Debug,
            "proxy(http://10.0.0.5:3128/) intercepts 'https://api.uexcorp.uk/'",
        )]);
        assert_eq!(text, "");
    }

    /// A fresh empty folder under the system temp directory, removed on drop.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("sc-trade-test-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_flag_is_a_file_with_that_name_in_the_folder() {
        let dir = TempDir::new("flag-helper");
        assert!(!flag_in(&dir.0, "some.flag"));
        std::fs::write(dir.0.join("some.flag"), "").unwrap();
        assert!(flag_in(&dir.0, "some.flag"));
        // Another flag of the same folder does not count, nor does a folder of that name.
        assert!(!flag_in(&dir.0, "other.flag"));
        std::fs::create_dir(dir.0.join("folder.flag")).unwrap();
        assert!(!flag_in(&dir.0, "folder.flag"));
    }

    #[test]
    fn the_flag_next_to_the_exe_is_looked_for_in_the_exes_folder() {
        let exe = std::env::current_exe().unwrap();
        assert_eq!(exe_dir().as_deref(), exe.parent());
        // The test exe's folder holds no such file.
        assert!(!flag_next_to_exe("no-such-flag-for-the-test-exe.flag"));
    }

    #[test]
    fn no_extra_log_without_the_portable_flag() {
        let dir = TempDir::new("no-flag");
        assert_eq!(portable_log(&dir.0), PortableLog::Off);
    }

    #[test]
    fn the_portable_flag_turns_on_a_log_next_to_the_exe() {
        let dir = TempDir::new("flag");
        std::fs::write(dir.0.join(PORTABLE_FLAG), "").unwrap();
        assert_eq!(portable_log(&dir.0), PortableLog::On(dir.0.clone()));
    }

    #[test]
    fn a_folder_named_like_the_flag_does_not_count() {
        let dir = TempDir::new("flag-folder");
        std::fs::create_dir(dir.0.join(PORTABLE_FLAG)).unwrap();
        assert_eq!(portable_log(&dir.0), PortableLog::Off);
    }

    #[test]
    fn the_probe_leaves_the_log_file_in_place_and_keeps_what_is_in_it() {
        let dir = TempDir::new("probe-keeps");
        std::fs::write(dir.0.join(PORTABLE_FLAG), "").unwrap();
        std::fs::write(portable_log_file(&dir.0), "earlier line\n").unwrap();
        assert_eq!(portable_log(&dir.0), PortableLog::On(dir.0.clone()));
        assert_eq!(
            std::fs::read_to_string(portable_log_file(&dir.0)).unwrap(),
            "earlier line\n"
        );
    }

    #[test]
    fn a_log_file_that_cannot_be_opened_is_left_out_and_explained() {
        // A folder where the log file should be: it cannot be opened for writing.
        let dir = TempDir::new("log-is-folder");
        std::fs::write(dir.0.join(PORTABLE_FLAG), "").unwrap();
        std::fs::create_dir(portable_log_file(&dir.0)).unwrap();
        match portable_log(&dir.0) {
            PortableLog::Unavailable { file, reason } => {
                assert_eq!(file, portable_log_file(&dir.0));
                assert!(!reason.is_empty());
            }
            other => panic!("expected Unavailable, got {other:?}"),
        }
    }

    #[test]
    fn a_read_only_log_file_is_left_out() {
        let dir = TempDir::new("log-read-only");
        std::fs::write(dir.0.join(PORTABLE_FLAG), "").unwrap();
        let file = portable_log_file(&dir.0);
        std::fs::write(&file, "").unwrap();
        let mut permissions = std::fs::metadata(&file).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&file, permissions).unwrap();

        let decision = portable_log(&dir.0);

        // Back to writable first, so that the folder can be removed even if the assert fails.
        let mut permissions = std::fs::metadata(&file).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        std::fs::set_permissions(&file, permissions).unwrap();
        assert!(
            matches!(decision, PortableLog::Unavailable { .. }),
            "{decision:?}"
        );
    }
}
