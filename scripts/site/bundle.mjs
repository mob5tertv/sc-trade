// The scripts of the pages are written as ES modules (site/js/*.js), so that the tests can import their functions.
// A page opened from the disk cannot load modules, so the build joins them into one plain script: the files in the
// order given, `import` lines dropped, `export` words dropped, all inside one function.
//
// What a source file may use, and nothing else: `import { a, b } from './file.js';` on one line, and `export` in
// front of a function or a constant. Every top-level name must be unique among the files of one bundle.

/**
 * @param {Array<{ name: string, source: string }>} files in the order they must run
 * @returns {string}
 */
export function bundleScripts(files) {
  const parts = files.map(({ name, source }) => {
    const body = source
      .replaceAll('\r\n', '\n')
      .replace(/^import \{[^}]*\} from '\.\/[\w.-]+\.js';\n/gm, '')
      .replace(/^export (?=(async function|function|const|class) )/gm, '');
    const left = /^\s*(import|export)\b.*$/m.exec(body);
    if (left !== null) throw new Error(`${name}: the bundle cannot take the line "${left[0].trim()}"`);
    return `// ---- ${name}\n${body.trim()}\n`;
  });
  return `(function () {\n'use strict';\n\n${parts.join('\n')}})();\n`;
}
