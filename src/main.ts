import { mount } from 'svelte';
import { createLogger } from './data/logger';
import { installCrashHandlers } from './platform/crash';
import { tauriSink } from './platform/tauri-logger';
import App from './ui/App.svelte';
import { app } from './ui/state.svelte';
import './ui/theme.css';

// The first line of the log ("[app] start" with the versions) is written by `boot()`, once the database
// and the settings are there.
const log = createLogger(tauriSink());
installCrashHandlers(log);
app.init(log);

mount(App, { target: document.getElementById('app')! });
