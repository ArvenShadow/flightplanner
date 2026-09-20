/**
 * Reading a VAC's page geometry - tools/vac-pdf.mjs
 *
 * The impure half of the georeferencing: pdfjs in, plain numbers out. Every
 * rule about what those numbers MEAN lives in tools/vac-geo.mjs, which has no
 * PDF library in it and is unit-tested in bare Node.
 *
 * TWO THINGS ABOUT pdfjs 6 THAT ARE EASY TO GET WRONG, both found by reading
 * the actual argument shapes rather than the documentation:
 *   - `constructPath` carries its path in args[1] as an ARRAY OF SUBPATHS,
 *     each a Float32Array of [command, x, y, command, x, y, ...]. Treating it
 *     as one flat array silently yields no segments at all.
 *   - the coordinates are in the path's own space and can be in the thousands;
 *     the current transformation matrix is what puts them on the page, so the
 *     save/restore/transform stack has to be tracked or every graticule tick
 *     lands somewhere absurd.
 */

/** @typedef {{a: [number, number], b: [number, number]}} Segment */

const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Load pdfjs once. */
export async function pdfjs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

/**
 * Every straight stroke and every positioned text run on a page, in PDF user
 * space with the CTM applied.
 *
 * @param {Uint8Array} bytes @param {number} pageNumber
 * @returns {Promise<{segments: Segment[], textItems: {str: string, x: number, y: number, width: number}[],
 *                    width: number, height: number, numPages: number}>}
 */
export async function pageGeometry(bytes, pageNumber = 1) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const textItems = content.items
    .filter((i) => i && typeof i.str === 'string' && i.str.trim())
    .map((i) => ({ str: i.str.trim(), x: i.transform[4], y: i.transform[5], width: i.width }));

  const ops = await page.getOperatorList();
  const OPS = lib.OPS;
  /** @type {Segment[]} */ const segments = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = multiply(ctm, args);
    else if (fn === OPS.constructPath) {
      const subpaths = args[1];
      if (!subpaths || !subpaths[Symbol.iterator]) continue;
      for (const d of subpaths) {
        let k = 0, current = null, start = null;
        while (k < d.length) {
          const command = d[k];
          if (command === 0) { current = apply(ctm, d[k + 1], d[k + 2]); start = current; k += 3; }
          else if (command === 1) {
            const p = apply(ctm, d[k + 1], d[k + 2]);
            if (current) segments.push({ a: current, b: p });
            current = p; k += 3;
          } else if (command === 2) { current = apply(ctm, d[k + 5], d[k + 6]); k += 7; }
          else if (command === 3) { current = apply(ctm, d[k + 3], d[k + 4]); k += 5; }
          else if (command === 4) {
            if (current && start) segments.push({ a: current, b: start });
            current = start; k += 1;
          } else break;
        }
      }
    }
  }
  return { segments, textItems, width: viewport.width, height: viewport.height, numPages: doc.numPages };
}
