import { getVersion } from '@tauri-apps/api/app';
import { mount } from 'svelte';
import { createLogger } from './data/logger';
import { installCrashHandlers } from './platform/crash';
import { tauriSink } from './platform/tauri-logger';
import App from './ui/App.svelte';

async function appVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return 'unknown'; // not running inside Tauri (plain browser)
  }
}

const log = createLogger(tauriSink());
installCrashHandlers(log);
log.info('app', 'start', { version: await appVersion() });

mount(App, { target: document.getElementById('app')!, props: { log } });
