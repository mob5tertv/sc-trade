import { invoke } from '@tauri-apps/api/core';

/** The words of the tray menu in the language of the window (`set_tray_labels` in `src-tauri/src/tray.rs`, version 1.3). */
export async function setTrayLabels(showPanel: string, quit: string): Promise<void> {
  await invoke('set_tray_labels', { showPanel, quit });
}
