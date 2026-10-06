use std::path::{Path, PathBuf};

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

/// The folder to put the portable log into: `exe_dir` itself when `portable.flag` (a file) is there.
fn portable_log_dir(exe_dir: &Path) -> Option<PathBuf> {
    exe_dir
        .join(PORTABLE_FLAG)
        .is_file()
        .then(|| exe_dir.to_path_buf())
}

/// `portable_log_dir` for the folder of the running exe.
fn running_portable_log_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    portable_log_dir(exe.parent()?)
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
    if let Some(path) = running_portable_log_dir() {
        targets.push(Target::new(TargetKind::Folder {
            path,
            file_name: Some(PORTABLE_LOG_NAME.into()),
        }));
    }
    tauri_plugin_log::Builder::new()
        .targets(targets)
        .max_file_size(MAX_FILE_SIZE)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_FILES))
        .level(LevelFilter::Debug)
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

/// Says in the log that the extra log file next to the exe is on. Call it once the logger runs
/// (the `setup` hook), because `plugin()` runs before there is a logger.
pub fn announce_portable_log() {
    if let Some(dir) = running_portable_log_dir() {
        log::info!(
            "[log] {PORTABLE_FLAG} found, the log is also written to {}",
            dir.join(format!("{PORTABLE_LOG_NAME}.log")).display()
        );
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
/// its own entries before sending them (see `applyLogLevel` in the frontend).
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
    fn no_extra_log_without_the_portable_flag() {
        let dir = TempDir::new("no-flag");
        assert_eq!(portable_log_dir(&dir.0), None);
    }

    #[test]
    fn the_portable_flag_turns_on_a_log_next_to_the_exe() {
        let dir = TempDir::new("flag");
        std::fs::write(dir.0.join(PORTABLE_FLAG), "").unwrap();
        assert_eq!(portable_log_dir(&dir.0), Some(dir.0.clone()));
    }

    #[test]
    fn a_folder_named_like_the_flag_does_not_count() {
        let dir = TempDir::new("flag-folder");
        std::fs::create_dir(dir.0.join(PORTABLE_FLAG)).unwrap();
        assert_eq!(portable_log_dir(&dir.0), None);
    }
}
