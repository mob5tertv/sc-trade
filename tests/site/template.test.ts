import { describe, expect, it } from 'vitest';
import { escapeHtml, fillPlaceholders, render } from '../../scripts/site/template.mjs';

const page = (source: string, scope: Record<string, unknown>, extra: Parameters<typeof render>[2] = {}) =>
  render(source, scope, { name: 'test.html', ...extra });

describe('render', () => {
  it('puts a value in and escapes what HTML would read as markup', () => {
    expect(page('<p>{{t.text}}</p>', { t: { text: 'a < b & "c" > d\'s' } })).toBe('<p>a &lt; b &amp; &quot;c&quot; &gt; d&#39;s</p>');
  });

  it('writes a number as it is', () => {
    expect(page('{{year}}', { year: 2026 })).toBe('2026');
  });

  it('puts a raw value in without escaping', () => {
    expect(page('{{{html}}}', { html: '<b>x</b>' })).toBe('<b>x</b>');
  });

  it('fails with the name of the template and of the value when the value is missing', () => {
    expect(() => page('{{t.nope}}', { t: {} })).toThrow(/test\.html.*t\.nope/);
  });

  it('fails when a value is not a text or a number', () => {
    expect(() => page('{{t}}', { t: { a: 1 } })).toThrow(/test\.html.*"t".*text or a number/);
  });

  it('keeps one branch of an if', () => {
    const source = '{{#if on}}yes{{else}}no{{/if}}';
    expect(page(source, { on: true })).toBe('yes');
    expect(page(source, { on: false })).toBe('no');
    expect(page(source, { on: '' })).toBe('no');
    expect(page(source, { on: [] })).toBe('no');
    expect(page(source, {})).toBe('no');
  });

  it('turns an unless around', () => {
    expect(page('{{#unless on}}off{{/unless}}', { on: false })).toBe('off');
    expect(page('{{#unless on}}off{{/unless}}', { on: 'x' })).toBe('');
  });

  it('repeats a block for every item, with the item, its number and the values around it', () => {
    const source = '{{#each list}}[{{@number}}/{{@nn}} {{name}} {{this.name}} {{sep}}]{{/each}}';
    expect(page(source, { sep: '|', list: [{ name: 'a' }, { name: 'b' }] })).toBe('[1/01 a a |][2/02 b b |]');
  });

  it('repeats a block for a list of texts', () => {
    expect(page('{{#each list}}<li>{{this}}</li>{{/each}}', { list: ['a', '<b>'] })).toBe('<li>a</li><li>&lt;b&gt;</li>');
  });

  it('fails when each is given something that is not a list', () => {
    expect(() => page('{{#each t}}x{{/each}}', { t: 'text' })).toThrow(/test\.html.*"t".*list/);
  });

  it('nests blocks', () => {
    const source = '{{#each rows}}{{#if open}}<{{#each cells}}{{this}}{{/each}}>{{/if}}{{/each}}';
    expect(page(source, { rows: [{ open: true, cells: ['a', 'b'] }, { open: false, cells: ['c'] }] })).toBe('<ab>');
  });

  it('puts a partial in, with the values of the place it stands in', () => {
    expect(page('{{#each list}}{{> item}}{{/each}}', { list: [{ name: 'a' }, { name: 'b' }] }, { partials: { item: '<i>{{name}}</i>' } })).toBe(
      '<i>a</i><i>b</i>',
    );
  });

  it('fails on a partial nobody wrote', () => {
    expect(() => page('{{> nope}}', {})).toThrow(/test\.html.*partial "nope"/);
  });

  it('calls a helper with a quoted text or with a value, and escapes what it gives', () => {
    const helpers = { shout: (text: string) => `${text.toUpperCase()}&` };
    expect(page('{{shout "ab"}} {{shout word}}', { word: 'cd' }, { helpers })).toBe('AB&amp; CD&amp;');
  });

  it('fails on a helper nobody wrote', () => {
    expect(() => page('{{nope "x"}}', {})).toThrow(/test\.html.*helper "nope"/);
  });

  it('drops comments', () => {
    expect(page('a{{! not for the page }}b', {})).toBe('ab');
  });

  it('fails on a block that is not closed, and on a close without a block', () => {
    expect(() => page('{{#if a}}x', {})).toThrow(/test\.html.*not closed/);
    expect(() => page('x{{/if}}', {})).toThrow(/test\.html.*nothing to close/);
    expect(() => page('{{#if a}}x{{/each}}', {})).toThrow(/test\.html.*\/each.*if/);
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});

describe('fillPlaceholders', () => {
  it('puts the values in as they are, braces of the server config left alone', () => {
    expect(fillPlaceholders('{{domain}} {\n\troot * {{root}}\n\tredir {uri}\n}', { domain: 'example.test', root: '/var/www/x' })).toBe(
      'example.test {\n\troot * /var/www/x\n\tredir {uri}\n}',
    );
  });

  it('fails on a placeholder without a value', () => {
    expect(() => fillPlaceholders('{{nope}}', {})).toThrow(/nope/);
  });
});
