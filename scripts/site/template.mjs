// The templates of the site (site/templates/*.html): a small language of its own, so that the build needs nothing
// but Node. A value that is missing is an error, never an empty place on the page.
//
//   {{a.b}}                    a value, escaped for HTML
//   {{{a.b}}}                  a value as it is (HTML the build made itself)
//   {{#if a}}…{{else}}…{{/if}}   {{#unless a}}…{{/unless}}
//   {{#each list}}…{{/each}}   inside: the fields of the item, {{this}}, {{@index}}, {{@number}} (from 1), {{@nn}} (01, 02…)
//   {{> name}}                 a partial, with the values of the place it stands in
//   {{helper "text"}}          {{helper a.b}}   a helper with one argument; what it gives is escaped
//   {{! a note }}              nothing

/**
 * @typedef {{ type: 'text', text: string }
 *   | { type: 'value', path: string, raw: boolean }
 *   | { type: 'helper', name: string, argument: string, literal: boolean }
 *   | { type: 'partial', name: string }
 *   | { type: 'if', path: string, negate: boolean, then: Node[], otherwise: Node[] }
 *   | { type: 'each', path: string, body: Node[] }} Node
 *
 * @typedef {{
 *   name?: string,
 *   partials?: Record<string, string>,
 *   helpers?: Record<string, (argument: string) => string>,
 * }} RenderOptions
 */

/** @param {unknown} text */
export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const TAG = /\{\{\{\s*([^{}]+?)\s*\}\}\}|\{\{\s*([^{}]+?)\s*\}\}/g;
const PATH = /^(?:this|@?[\w-]+)(?:\.[\w-]+)*$/;

/**
 * @param {string} source
 * @param {string} name the name of the template, for the errors
 * @returns {Node[]}
 */
function parse(source, name) {
  /** @type {Node[]} */
  const root = [];
  /** @type {Array<{ kind: string, into: Node[], node?: Extract<Node, { type: 'if' }> }>} */
  const open = [{ kind: 'root', into: root }];
  const fail = (/** @type {string} */ message) => new Error(`template ${name}: ${message}`);
  let last = 0;

  for (const match of source.matchAll(TAG)) {
    const into = open[open.length - 1].into;
    if (match.index > last) into.push({ type: 'text', text: source.slice(last, match.index) });
    last = match.index + match[0].length;

    if (match[1] !== undefined) {
      if (!PATH.test(match[1])) throw fail(`"${match[0]}" is not a value`);
      into.push({ type: 'value', path: match[1], raw: true });
      continue;
    }
    const tag = match[2];
    if (tag.startsWith('!')) continue;

    if (tag.startsWith('#')) {
      const [kind, path, ...rest] = tag.slice(1).split(/\s+/);
      if (!['if', 'unless', 'each'].includes(kind) || path === undefined || rest.length > 0 || !PATH.test(path)) throw fail(`"${match[0]}" is not a block`);
      if (kind === 'each') {
        /** @type {Extract<Node, { type: 'each' }>} */
        const node = { type: 'each', path, body: [] };
        into.push(node);
        open.push({ kind, into: node.body });
      } else {
        /** @type {Extract<Node, { type: 'if' }>} */
        const node = { type: 'if', path, negate: kind === 'unless', then: [], otherwise: [] };
        into.push(node);
        open.push({ kind, into: node.then, node });
      }
      continue;
    }

    if (tag === 'else') {
      const block = open[open.length - 1];
      if (block.node === undefined || block.into === block.node.otherwise) throw fail('"{{else}}" stands outside an if');
      block.into = block.node.otherwise;
      continue;
    }

    if (tag.startsWith('/')) {
      const kind = tag.slice(1).trim();
      const block = open[open.length - 1];
      if (block.kind === 'root') throw fail(`"${match[0]}" has nothing to close`);
      if (block.kind !== kind) throw fail(`"{{/${kind}}}" closes a block that was opened as "${block.kind}"`);
      open.pop();
      continue;
    }

    if (tag.startsWith('>')) {
      into.push({ type: 'partial', name: tag.slice(1).trim() });
      continue;
    }

    const call = /^([\w-]+)\s+(?:"([^"]*)"|(\S+))$/.exec(tag);
    if (call !== null) {
      if (call[3] !== undefined && !PATH.test(call[3])) throw fail(`"${match[0]}" is not a call of a helper`);
      into.push({ type: 'helper', name: call[1], argument: call[2] ?? call[3], literal: call[2] !== undefined });
      continue;
    }
    if (!PATH.test(tag)) throw fail(`"${match[0]}" is not a value`);
    into.push({ type: 'value', path: tag, raw: false });
  }

  if (open.length > 1) throw fail(`the block "${open[open.length - 1].kind}" is not closed`);
  if (last < source.length) root.push({ type: 'text', text: source.slice(last) });
  return root;
}

/**
 * The value of a path: the nearest scope that knows its first name wins. `undefined` when nobody knows it.
 * @param {string} path
 * @param {Array<Record<string, unknown>>} scopes the innermost last
 */
function lookup(path, scopes) {
  const [first, ...rest] = path.split('.');
  /** @type {unknown} */
  let value;
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (Object.hasOwn(scopes[i], first)) {
      value = scopes[i][first];
      break;
    }
  }
  for (const key of rest) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = /** @type {Record<string, unknown>} */ (value)[key];
  }
  return value;
}

const isOn = (/** @type {unknown} */ value) => !(value === undefined || value === null || value === false || value === '' || value === 0 || (Array.isArray(value) && value.length === 0));

/**
 * @param {string} source
 * @param {Record<string, unknown>} scope
 * @param {RenderOptions} [options]
 * @returns {string}
 */
export function render(source, scope, options = {}) {
  const name = options.name ?? 'template';
  const partials = options.partials ?? {};
  const helpers = options.helpers ?? {};
  /** @type {Map<string, Node[]>} */
  const parsed = new Map();
  const fail = (/** @type {string} */ where, /** @type {string} */ message) => new Error(`template ${where}: ${message}`);

  /** @param {string} path @param {Array<Record<string, unknown>>} scopes @param {string} where */
  const text = (path, scopes, where) => {
    const value = lookup(path, scopes);
    if (value === undefined || value === null) throw fail(where, `no value for "${path}"`);
    if (typeof value !== 'string' && typeof value !== 'number') throw fail(where, `"${path}" is not a text or a number`);
    return String(value);
  };

  /** @param {Node[]} nodes @param {Array<Record<string, unknown>>} scopes @param {string} where @returns {string} */
  const walk = (nodes, scopes, where) => {
    let out = '';
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          out += node.text;
          break;
        case 'value':
          out += node.raw ? text(node.path, scopes, where) : escapeHtml(text(node.path, scopes, where));
          break;
        case 'helper': {
          const helper = helpers[node.name];
          if (helper === undefined) throw fail(where, `the helper "${node.name}" does not exist`);
          out += escapeHtml(helper(node.literal ? node.argument : text(node.argument, scopes, where)));
          break;
        }
        case 'partial': {
          const partial = partials[node.name];
          if (partial === undefined) throw fail(where, `the partial "${node.name}" does not exist`);
          let tree = parsed.get(node.name);
          if (tree === undefined) {
            tree = parse(partial, node.name);
            parsed.set(node.name, tree);
          }
          out += walk(tree, scopes, node.name);
          break;
        }
        case 'if':
          out += walk(isOn(lookup(node.path, scopes)) !== node.negate ? node.then : node.otherwise, scopes, where);
          break;
        case 'each': {
          const list = lookup(node.path, scopes);
          if (!Array.isArray(list)) throw fail(where, `"${node.path}" is not a list`);
          list.forEach((item, index) => {
            const fields = item !== null && typeof item === 'object' && !Array.isArray(item) ? item : {};
            const own = { ...fields, this: item, '@index': index, '@number': index + 1, '@nn': String(index + 1).padStart(2, '0') };
            out += walk(node.body, [...scopes, own], where);
          });
          break;
        }
      }
    }
    return out;
  };

  return walk(parse(source, name), [scope], name);
}

/**
 * For a file that is not HTML (the config of the web server): `{{name}}` is replaced by its value as it is, and
 * everything else, single braces too, is left alone.
 * @param {string} source
 * @param {Record<string, string>} values
 */
export function fillPlaceholders(source, values) {
  return source.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, /** @type {string} */ name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`no value for the placeholder "${name}"`);
    return values[name];
  });
}
