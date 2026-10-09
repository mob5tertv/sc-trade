// Starts the service: `node src/main.mjs [the file of the settings]` (systemd does it: sc-trade-site.service).
// Settings that are missing or wrong stop it at once, with a phrase that names what to fix and the exit code 78, at
// which systemd does not start it again.
import { DEFAULT_CONFIG_PATH, loadSettings } from './config.mjs';
import { errorWord } from './http.mjs';
import { createService } from './service.mjs';

const EXIT_CONFIG = 78;

/** An error nobody expected: its kind and where in the code it came from, never its message. */
const crash = (/** @type {string} */ what, /** @type {unknown} */ err) => {
  const where = err instanceof Error && typeof err.stack === 'string' ? err.stack.split('\n').filter((line) => /^\s+at /.test(line)).slice(0, 6).join('\n') : '';
  console.error(`${new Date().toISOString()} ${what} ${errorWord(err)}${where === '' ? '' : `\n${where}`}`);
  process.exit(1);
};
process.on('uncaughtException', (err) => crash('crash', err));
process.on('unhandledRejection', (err) => crash('crash', err));

/** @type {import('./config.mjs').Settings} */
let settings;
try {
  settings = loadSettings(process.argv[2] ?? DEFAULT_CONFIG_PATH);
} catch (err) {
  console.error(`sc-trade-site does not start: ${err instanceof Error ? err.message : err}`);
  process.exit(EXIT_CONFIG);
}

const service = createService({ settings });
try {
  const port = await service.listen();
  console.log(`${new Date().toISOString()} started address=127.0.0.1 port=${port}`);
} catch (err) {
  console.error(`sc-trade-site does not start: ${errorWord(err)} (the folder of the data ${settings.dataDir} must be writable by the service, and the port ${settings.port} must be free)`);
  process.exit(1);
}

for (const signal of /** @type {const} */ (['SIGTERM', 'SIGINT'])) {
  process.on(signal, () => {
    console.log(`${new Date().toISOString()} stopping`);
    void service.close().then(() => process.exit(0));
  });
}
