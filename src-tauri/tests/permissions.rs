//! What the webview is allowed to ask of the shell, pinned against the files that grant it:
//! `capabilities/default.json` and the `plugins` block of `tauri.conf.json`. These files are read by
//! the build, and a mistake in them shows only in the running window, so it is checked here instead.

use serde_json::Value;

const CAPABILITY: &str = include_str!("../capabilities/default.json");
const TAURI_CONF: &str = include_str!("../tauri.conf.json");

/// The identifiers listed under `permissions` (an entry is a string, or an object with `identifier`).
fn granted_permissions() -> Vec<String> {
    let capability: Value = serde_json::from_str(CAPABILITY).unwrap();
    capability["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| match entry {
            Value::String(id) => id.clone(),
            other => other["identifier"].as_str().unwrap().to_owned(),
        })
        .collect()
}

#[test]
fn the_opener_only_reveals_an_item_in_its_folder() {
    // The interface calls `revealItemInDir` once ("Открыть папку логов") and nothing else of the
    // plugin; `opener:default` would also let the page open any address in the browser.
    let opener: Vec<String> = granted_permissions()
        .into_iter()
        .filter(|id| id.starts_with("opener:"))
        .collect();
    assert_eq!(opener, ["opener:allow-reveal-item-in-dir"]);
}

#[test]
fn a_redirect_of_the_uex_host_cannot_lead_the_http_plugin_elsewhere() {
    let conf: Value = serde_json::from_str(TAURI_CONF).unwrap();
    // The plugin reads this block into its own `Config` (which refuses unknown keys, so a typo here
    // would stop the plugin from starting); the same type is used here.
    let config: tauri_plugin_http::Config =
        serde_json::from_value(conf["plugins"]["http"].clone()).unwrap();
    assert!(config.scope_redirects);
}
