import { mount } from 'svelte';
import { createLogger } from './data/logger';
import { installCrashHandlers } from './platform/crash';
import { tauriSink } from './platform/tauri-logger';
import { langOf } from './i18n';
import App from './ui/App.svelte';
import { app } from './ui/state.svelte';
import './ui/theme.css';

// The first line of the log ("[app] start" with the versions) is written by `boot()`, once the database
// and the settings are there.
const log = createLogger(tauriSink());
installCrashHandlers(log);
app.init(log);
// until the settings are read, the window speaks the language of Windows (`setSettings` takes the chosen one)
app.useLanguage(langOf(navigator.language));

mount(App, { target: document.getElementById('app')! });
