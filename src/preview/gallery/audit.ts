// What a look at a picture cannot say for sure: whether a number is cut, whether a window scrolls sideways, how high
// the rows really are. `window.__galleryAudit()` measures the page that is drawn; use it with
// `npm run preview:shot -- --gallery <page> --do "eval:window.__galleryAudit()"`.

export interface GalleryAudit {
  /** States whose glass is wider than its frame: a horizontal scroll. */
  sidewaysScroll: string[];
  /** The states by the width of their frame (the window is 440 px; the mini line is as wide as its content, at most 520 px). */
  widths: Record<string, string[]>;
  /** A cell with a number whose text does not fit it (a number must never be cut). */
  clippedNumbers: string[];
  /** Texts that are cut with an ellipsis on purpose (names, titles). */
  ellipsised: number;
  /** The heights of what the theme gives a height to, each distinct value once. */
  heights: Record<string, number[]>;
}

const NUMBER = /^[\s\d.,%–\-+≈/кMчk()]*\d[\s\d.,%–\-+≈/кMчk()]*$/;

const distinct = (values: number[]): number[] => [...new Set(values.map((v) => Math.round(v * 10) / 10))].sort((a, b) => a - b);

const MEASURED: Record<string, string> = {
  'row of a table (22)': '.table .row:not(.selected):not(.expanded), .list .row:not(.selected):not(.expanded), div.grid.line',
  'head of columns (18)': '.grid.head, .row.header',
  'header of a section (24)': '.section > .head',
  'field or button in a row (22)': '.in-price, .in-scu, .quick .sc-input, .quick .sc-btn, .edit .sc-btn, .foot .sc-btn',
  'mini line (26)': '.strip',
};

export function auditGallery(root: ParentNode = document): GalleryAudit {
  const audit: GalleryAudit = { sidewaysScroll: [], widths: {}, clippedNumbers: [], ellipsised: 0, heights: {} };
  for (const figure of root.querySelectorAll<HTMLElement>('[data-state]')) {
    const name = figure.dataset.state ?? '?';
    const glass = figure.querySelector<HTMLElement>('.sc-frame__glass');
    const frame = figure.querySelector<HTMLElement>('.sc-frame');
    if (glass === null || frame === null) continue;
    if (glass.scrollWidth > glass.clientWidth) audit.sidewaysScroll.push(name);
    (audit.widths[String(Math.round(frame.getBoundingClientRect().width))] ??= []).push(name);

    for (const el of glass.querySelectorAll<HTMLElement>('*')) {
      if (el.scrollWidth <= el.clientWidth + 1 || el.clientWidth === 0) continue;
      if (getComputedStyle(el).overflowX === 'visible') continue;
      const text = (el.textContent ?? '').trim();
      if (text === '' || el.tagName === 'INPUT') continue;
      if (NUMBER.test(text)) audit.clippedNumbers.push(`${name}: "${text}"`);
      else audit.ellipsised++;
    }
  }
  for (const [label, selector] of Object.entries(MEASURED)) {
    const found = [...root.querySelectorAll<HTMLElement>(selector)].map((el) => el.getBoundingClientRect().height);
    if (found.length > 0) audit.heights[label] = distinct(found);
  }
  return audit;
}
