use std::fs;
use std::path::Path;

use tauri::Manager;
use tauri_plugin_log::TimezoneStrategy;

/// The database file, as opened by tauri-plugin-sql for the connection string `sqlite:sctrade.db`:
/// the plugin resolves it against `app_config_dir()` (`%APPDATA%\com.sctrade.app` on Windows).
const DB_FILE_NAME: &str = "sctrade.db";
const BACKUP_DIR_NAME: &str = "backups";
const BACKUP_PREFIX: &str = "sctrade-";
const BACKUP_SUFFIX: &str = ".db";
const KEEP_BACKUPS: usize = 5;

/// `sctrade-YYYYMMDD-HHMMSS.db`. Only files with exactly this shape are ever pruned,
/// so nothing a user dropped into the folder can be deleted.
fn is_backup_name(name: &str) -> bool {
    name.strip_prefix(BACKUP_PREFIX)
        .and_then(|rest| rest.strip_suffix(BACKUP_SUFFIX))
        .is_some_and(|stamp| {
            let bytes = stamp.as_bytes();
            bytes.len() == 15
                && bytes[8] == b'-'
                && bytes
                    .iter()
                    .enumerate()
                    .all(|(i, b)| i == 8 || b.is_ascii_digit())
        })
}

/// The names to delete so that only the `keep` newest remain. The timestamp inside a name is
/// zero-padded, so sorting by name sorts by age (oldest first).
fn to_prune(mut names: Vec<String>, keep: usize) -> Vec<String> {
    names.sort();
    names.truncate(names.len().saturating_sub(keep));
    names
}

/// Timestamp part of a backup name. UTC, so that name order stays chronological across
/// daylight-saving changes (the order is what `to_prune` relies on).
fn timestamp() -> String {
    let now = TimezoneStrategy::UseUtc.get_now();
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        now.year(),
        now.month() as u8,
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

/// Deletes the oldest backups in `dir`. A failure here never fails the backup that was just made.
fn prune(dir: &Path, keep: usize) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            log::warn!("[backup] cannot list {} for pruning: {err}", dir.display());
            return;
        }
    };
    let names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| is_backup_name(name))
        .collect();
    for name in to_prune(names, keep) {
        match fs::remove_file(dir.join(&name)) {
            Ok(()) => log::info!("[backup] removed old backup {name}"),
            Err(err) => log::warn!("[backup] cannot remove old backup {name}: {err}"),
        }
    }
}

/// Copies `<config_dir>/sctrade.db` to `<config_dir>/backups/sctrade-<stamp>.db` and prunes
/// old backups. `Ok(None)` means there is no database yet, so nothing was copied.
fn backup_in(config_dir: &Path, stamp: &str, keep: usize) -> Result<Option<String>, String> {
    let db = config_dir.join(DB_FILE_NAME);
    if !db.is_file() {
        return Ok(None);
    }
    let dir = config_dir.join(BACKUP_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|err| format!("cannot create {}: {err}", dir.display()))?;

    let name = format!("{BACKUP_PREFIX}{stamp}{BACKUP_SUFFIX}");
    let target = dir.join(&name);
    if let Err(err) = fs::copy(&db, &target) {
        // A partial copy would count as the newest backup and push a good one out.
        let _ = fs::remove_file(&target);
        return Err(format!(
            "cannot copy {} to {}: {err}",
            db.display(),
            target.display()
        ));
    }
    prune(&dir, keep);
    Ok(Some(name))
}

/// Backs the database up at launch. Returns the name of the new copy, or `None` when there is
/// no database file. The copy is of the ONE file, and the database keeps a write-ahead journal
/// next to it, so the webview calls this after it has opened the database and merged the journal
/// into the file (`PRAGMA wal_checkpoint(TRUNCATE)`), and before the migrations. A copy taken
/// while the newest pages were still in the journal was stale, or empty.
#[tauri::command(async)]
pub fn backup_db(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let config_dir = app.path().app_config_dir().map_err(|err| {
        let message = format!("cannot resolve the app config directory: {err}");
        log::error!("[backup] failed: {message}");
        message
    })?;
    match backup_in(&config_dir, &timestamp(), KEEP_BACKUPS) {
        Ok(Some(name)) => {
            log::info!("[backup] created {name}");
            Ok(Some(name))
        }
        Ok(None) => {
            log::info!(
                "[backup] skipped, no database yet in {}",
                config_dir.display()
            );
            Ok(None)
        }
        Err(err) => {
            log::error!("[backup] failed: {err}");
            Err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A fresh empty directory under the system temp dir, removed on drop.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("sctrade-test-{label}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn backup_names(config_dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(config_dir.join(BACKUP_DIR_NAME))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn prunes_everything_but_the_newest_five() {
        let names: Vec<String> = (1..=7)
            .map(|d| format!("sctrade-2026100{d}-120000.db"))
            .collect();
        assert_eq!(
            to_prune(names, 5),
            vec!["sctrade-20261001-120000.db", "sctrade-20261002-120000.db"]
        );
    }

    #[test]
    fn prunes_nothing_when_there_are_few_enough() {
        let names = vec![
            "sctrade-20261002-120000.db".to_string(),
            "sctrade-20261001-120000.db".to_string(),
        ];
        assert!(to_prune(names, 5).is_empty());
    }

    #[test]
    fn prunes_by_age_whatever_the_input_order() {
        let names = vec![
            "sctrade-20261003-120000.db".to_string(),
            "sctrade-20261001-120000.db".to_string(),
            "sctrade-20261002-120000.db".to_string(),
        ];
        assert_eq!(to_prune(names, 2), vec!["sctrade-20261001-120000.db"]);
    }

    #[test]
    fn recognises_only_backup_names() {
        assert!(is_backup_name("sctrade-20261007-091500.db"));
        assert!(!is_backup_name("sctrade.db"));
        assert!(!is_backup_name("sctrade-20261007-091500.db.tmp"));
        assert!(!is_backup_name("sctrade-2026100-0915000.db"));
        assert!(!is_backup_name("sctrade-notes.db"));
        assert!(!is_backup_name("readme.txt"));
    }

    #[test]
    fn timestamp_has_the_shape_of_a_backup_name() {
        assert!(is_backup_name(&format!(
            "{BACKUP_PREFIX}{}{BACKUP_SUFFIX}",
            timestamp()
        )));
    }

    #[test]
    fn reports_none_when_there_is_no_database() {
        let dir = TempDir::new("no-db");
        assert_eq!(backup_in(&dir.0, "20261007-120000", 5), Ok(None));
        assert!(!dir.0.join(BACKUP_DIR_NAME).exists());
    }

    #[test]
    fn copies_the_database_into_backups() {
        let dir = TempDir::new("copy");
        fs::write(dir.0.join(DB_FILE_NAME), b"database bytes").unwrap();
        let name = backup_in(&dir.0, "20261007-120000", 5).unwrap();
        assert_eq!(name.as_deref(), Some("sctrade-20261007-120000.db"));
        let copy = fs::read(
            dir.0
                .join(BACKUP_DIR_NAME)
                .join("sctrade-20261007-120000.db"),
        )
        .unwrap();
        assert_eq!(copy, b"database bytes");
        assert_eq!(
            fs::read(dir.0.join(DB_FILE_NAME)).unwrap(),
            b"database bytes"
        );
    }

    #[test]
    fn keeps_only_the_newest_backups_and_leaves_foreign_files_alone() {
        let dir = TempDir::new("prune");
        fs::write(dir.0.join(DB_FILE_NAME), b"x").unwrap();
        let backups = dir.0.join(BACKUP_DIR_NAME);
        fs::create_dir_all(&backups).unwrap();
        for day in 1..=6 {
            fs::write(
                backups.join(format!("sctrade-2026100{day}-120000.db")),
                b"old",
            )
            .unwrap();
        }
        fs::write(backups.join("notes.txt"), b"mine").unwrap();

        backup_in(&dir.0, "20261007-120000", 5).unwrap();

        assert_eq!(
            backup_names(&dir.0),
            vec![
                "notes.txt",
                "sctrade-20261003-120000.db",
                "sctrade-20261004-120000.db",
                "sctrade-20261005-120000.db",
                "sctrade-20261006-120000.db",
                "sctrade-20261007-120000.db",
            ]
        );
    }
}
