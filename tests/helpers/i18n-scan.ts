import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'svelte/compiler';
import ts from 'typescript';

// Reads the code of the window for the rules of the dictionary (`tests/i18n/dictionary.test.ts`): every phrase given to `tr` /
// `trn`, and every place that breaks a rule. Kept apart from the test so that a script can print what is left to move.

const root = join(__dirname, '..', '..');
const DIRS = ['src/ui', 'src/core', 'src/data', 'src/platform'];
const FILES = ['src/main.ts'];
export const CYRILLIC = /[А-Яа-яЁё]/;

function walkDir(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walkDir(path);
    return /\.(ts|svelte)$/.test(name) ? [path] : [];
  });
}

export const sources = [...DIRS.flatMap((dir) => walkDir(join(root, dir))), ...FILES.map((file) => join(root, file))]
  .map((path) => ({ file: relative(root, path).replace(/\\/g, '/'), code: readFileSync(path, 'utf8') }));

export interface Phrase { key: string; kind: 'tr' | 'trn'; where: string }
export interface Reading { phrases: Phrase[]; problems: string[] }

/** Which argument of the call is the phrase: the first of `tr`, the second of `trn` (after the number). */
const PHRASE_ARG: Record<string, number> = { tr: 0, trn: 1 };

const lineOf = (code: string, offset: number): number => code.slice(0, offset).split('\n').length;

function readTs(file: string, code: string): Reading {
  const phrases: Phrase[] = [];
  const problems: string[] = [];
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const where = (node: ts.Node): string => `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const phraseCall = (node: ts.Node): string | null => {
    const call = node.parent;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return null;
    const name = call.expression.text;
    return Object.hasOwn(PHRASE_ARG, name) && call.arguments[PHRASE_ARG[name]] === node ? name : null;
  };
  const insideFunction = (node: ts.Node): boolean => {
    for (let up = node.parent; up !== undefined; up = up.parent) if (ts.isFunctionLike(up)) return true;
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && Object.hasOwn(PHRASE_ARG, node.expression.text)) {
      const name = node.expression.text as 'tr' | 'trn';
      const arg = node.arguments[PHRASE_ARG[name]];
      if (arg === undefined || !(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) problems.push(`${where(node)} ${name}() without a literal phrase`);
      else phrases.push({ key: arg.text, kind: name, where: where(node) });
      if (!insideFunction(node)) problems.push(`${where(node)} ${name}() at the top of the module`);
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && CYRILLIC.test(node.text) && phraseCall(node) === null) {
      problems.push(`${where(node)} ${node.text}`);
    }
    if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('${…}');
      if (CYRILLIC.test(parts)) problems.push(`${where(node)} \`${parts}\``);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { phrases, problems };
}

type Node = { type?: string; start?: number; [key: string]: unknown };

function readSvelte(file: string, code: string): Reading {
  const phrases: Phrase[] = [];
  const problems: string[] = [];
  const ast = parse(code, { modern: true }) as unknown as Node;
  const where = (node: Node): string => `${file}:${lineOf(code, node.start ?? 0)}`;
  const isPhraseCall = (node: Node): node is Node & { callee: Node & { name: string }; arguments: Node[] } =>
    node.type === 'CallExpression' && (node.callee as Node)?.type === 'Identifier' && Object.hasOwn(PHRASE_ARG, (node.callee as { name: string }).name);
  const visit = (node: unknown, parent: Node | null, inModule: boolean, functions: number): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parent, inModule, functions);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const n = node as Node;
    if (n.type === 'Comment' || n.type === 'Line' || n.type === 'Block' || n.type === 'StyleSheet') return;
    if (n.type === 'Text' && typeof n.data === 'string' && CYRILLIC.test(n.data)) problems.push(`${where(n)} ${n.data.trim()}`);
    if (n.type === 'Literal' && typeof n.value === 'string' && CYRILLIC.test(n.value)) {
      const ok = parent !== null && isPhraseCall(parent) && parent.arguments[PHRASE_ARG[parent.callee.name]] === n;
      if (!ok) problems.push(`${where(n)} ${n.value}`);
    }
    if (n.type === 'TemplateLiteral') {
      const text = (n.quasis as Array<{ value: { cooked: string } }>).map((q) => q.value.cooked).join('${…}');
      if (CYRILLIC.test(text)) problems.push(`${where(n)} \`${text}\``);
    }
    if (isPhraseCall(n)) {
      const name = n.callee.name as 'tr' | 'trn';
      const arg = n.arguments[PHRASE_ARG[name]];
      if (arg?.type !== 'Literal' || typeof arg.value !== 'string') problems.push(`${where(n)} ${name}() without a literal phrase`);
      else phrases.push({ key: arg.value, kind: name, where: where(n) });
      if (inModule && functions === 0) problems.push(`${where(n)} ${name}() at the top of <script module>`);
    }
    const isFunction = n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';
    for (const [key, value] of Object.entries(n)) {
      if (key === 'parent' || key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'metadata') continue;
      const childInModule = inModule || (n.type === 'Root' && key === 'module');
      visit(value, n, childInModule, functions + (isFunction ? 1 : 0));
    }
  };
  visit(ast, null, false, 0);
  return { phrases, problems };
}

export const readings = sources.map(({ file, code }) => (file.endsWith('.svelte') ? readSvelte(file, code) : readTs(file, code)));
export const phrases = readings.flatMap((reading) => reading.phrases);
export const placeholders = (text: string): string[] => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();

