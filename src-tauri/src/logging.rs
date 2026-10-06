use log::LevelFilter;
use tauri::{Wry, plugin::TauriPlugin};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

const LOG_FILE_NAME: &str = "sctrade";
const MAX_FILE_SIZE: u128 = 5_000_000;
// `KeepSome(n)` keeps `n` archives next to the active file, so 4 gives five log files in total.
const KEEP_FILES: usize = 4;

/// Log plugin shared by Rust and the webview: one file in the app log directory
/// (`%LOCALAPPDATA%\com.sctrade.app\logs\sctrade.log`) plus stdout.
/// Line format: `2026-01-31 14:05:09.123 [DEBUG] message`.
pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::LogDir {
                file_name: Some(LOG_FILE_NAME.into()),
            }),
            Target::new(TargetKind::Stdout),
        ])
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
}
