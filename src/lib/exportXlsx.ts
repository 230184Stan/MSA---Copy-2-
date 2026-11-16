import { countSummary, buildSheets, type ExportBundle, type Sheet } from '@/lib/exportBuild';

/**
 * A formatted Excel workbook of the export: a Summary sheet, then one sheet per table with a
 * title banner, a frozen and filterable header, real dates, sized columns, banded rows and
 * print settings (landscape, fit to page width, header repeated on every page).
 */

const GREEN = 'FF0B4F28';
const BAND = 'FFF4FAF6';
const BORDER = 'FFC6E6CF';
const GREY = 'FF6B7280';

const RESULT_FILL: Record<string, [string, string]> = {
  Win: ['FFC6E6CF', 'FF0B4F28'],
  Draw: ['FFFBE9B0', 'FF7A5500'],
  Loss: ['FFF8D0CE', 'FFA52020'],
};
const STATUS_FILL: Record<string, [string, string]> = {
  Serving: ['FFF8D0CE', 'FFA52020'],
  Served: ['FFE5E7EB', 'FF374151'],
  Cancelled: ['FFE5E7EB', 'FF374151'],
};

const NUMERIC = /^(Age|Games played|Wins|Draws|Losses|Goals|Yellow cards|Red cards|Suspensions \(total\)|Matches .*|Minute|Score)$/;
const isoDay = /^(\d{4})-(\d{2})-(\d{2})/;

function toDate(v: unknown): Date | null {
  const m = isoDay.exec(String(v ?? ''));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

function colLetter(n: number): string {
  let s = '';
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

export async function buildXlsx(bundle: ExportBundle): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Madang Soccer Association';
  wb.created = new Date(bundle.exported_at);
  const exportedOn = new Date(bundle.exported_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const font = { name: 'Calibri', size: 11 };
  const thin = { style: 'thin' as const, color: { argb: BORDER } };

  // ---- Summary ----
  const sum = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  sum.columns = [{ width: 30 }, { width: 18 }, { width: 60 }];
  sum.mergeCells('A1:C1');
  Object.assign(sum.getCell('A1'), { value: 'Madang Soccer Association' });
  sum.getCell('A1').font = { name: 'Calibri', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
  sum.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
  sum.getCell('A1').alignment = { vertical: 'middle', indent: 1 };
  sum.getRow(1).height = 36;
  sum.mergeCells('A2:C2');
  sum.getCell('A2').value = 'Player information and records';
  sum.getCell('A2').font = { name: 'Calibri', size: 13, color: { argb: GREEN } };
  sum.getCell('A2').alignment = { indent: 1 };
  sum.getRow(2).height = 24;
  sum.getCell('A4').value = 'Exported on';
  sum.getCell('B4').value = exportedOn;
  sum.getCell('A5').value = 'Covers';
  sum.getCell('B5').value = bundle.scope;
  for (const r of [4, 5]) {
    sum.getCell(`A${r}`).font = { ...font, bold: true };
    sum.getCell(`B${r}`).font = font;
    sum.getCell(`B${r}`).alignment = { horizontal: 'left' };
  }

  const n = countSummary(bundle);
  const counts: [string, number, string][] = [
    ['Players', n.players, 'Sheet "Players"'],
    ['Game records', n.games, 'Sheet "Game log"'],
    ['Goals, cards and substitutions', n.events, 'Sheet "Goals and cards"'],
    ['Suspensions', n.suspensions, 'Sheet "Suspensions"'],
    ['Players with a photo', n.photos, 'In the photos folder of the zip'],
  ];
  const head = sum.getRow(7);
  ['What', 'Count', 'Where to find it'].forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    c.alignment = { horizontal: i === 1 ? 'center' : 'left', vertical: 'middle', indent: i === 1 ? 0 : 1 };
  });
  head.height = 22;
  counts.forEach(([a, b, c], i) => {
    const row = sum.getRow(8 + i);
    row.values = [a, b, c];
    row.eachCell((cell, col) => {
      cell.font = font;
      cell.border = { bottom: thin };
      cell.alignment = { horizontal: col === 2 ? 'center' : 'left', vertical: 'middle', indent: col === 2 ? 0 : 1 };
      if (i % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    });
    row.height = 20;
  });
  sum.mergeCells('A14:C15');
  sum.getCell('A14').value =
    'These sheets contain personal details of players, some of them children. Store and share them carefully. ' +
    'Only finished, published matches count as games.';
  sum.getCell('A14').font = { ...font, size: 10, italic: true, color: { argb: GREY } };
  sum.getCell('A14').alignment = { wrapText: true, vertical: 'top', indent: 1 };
  sum.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ---- Data sheets ----
  for (const sheet of buildSheets(bundle)) addSheet(wb, sheet, exportedOn, bundle.scope);

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);

  function addSheet(book: typeof wb, s: Sheet, on: string, scope: string) {
    const ws = book.addWorksheet(s.name, {
      views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
      properties: { tabColor: { argb: GREEN } },
    });
    const cols = s.header.length;
    const last = colLetter(cols);

    ws.mergeCells(`A1:${last}1`);
    const title = ws.getCell('A1');
    title.value = `Madang Soccer Association  ·  ${s.name}`;
    title.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    title.alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 30;
    ws.mergeCells(`A2:${last}2`);
    const sub = ws.getCell('A2');
    sub.value = `${scope}  ·  exported ${on}  ·  ${s.rows.length} row${s.rows.length === 1 ? '' : 's'}`;
    sub.font = { name: 'Calibri', size: 10, color: { argb: GREY } };
    sub.alignment = { indent: 1, vertical: 'middle' };
    ws.getRow(2).height = 18;

    const hr = ws.getRow(4);
    s.header.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
      c.alignment = { vertical: 'middle', horizontal: NUMERIC.test(h) ? 'center' : 'left', wrapText: true, indent: NUMERIC.test(h) ? 0 : 1 };
      c.border = { bottom: { style: 'medium', color: { argb: GREEN } } };
    });
    hr.height = 34;

    const widths = s.header.map((h) => Math.min(h.length, 14));
    s.rows.forEach((r, ri) => {
      const row = ws.getRow(5 + ri);
      r.forEach((v, ci) => {
        const cell = row.getCell(ci + 1);
        const h = s.header[ci];
        let out: unknown = v === '' || v === null || v === undefined ? null : v;
        let len = String(v ?? '').length;
        if (s.dateCols.includes(ci)) {
          const d = toDate(v);
          if (d) { out = d; cell.numFmt = 'dd mmm yyyy'; len = 11; }
        }
        cell.value = out as never;
        cell.font = h === 'Player ID' ? { name: 'Calibri', size: 9, color: { argb: GREY } } : font;
        cell.border = { bottom: thin };
        const numeric = NUMERIC.test(h) || s.dateCols.includes(ci);
        cell.alignment = { vertical: 'middle', horizontal: numeric ? 'center' : 'left', indent: numeric ? 0 : 1 };
        if (ri % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
        const tint = (h === 'Result' && RESULT_FILL[String(v)]) || (h === 'Status' && STATUS_FILL[String(v)]) || null;
        if (tint) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint[0] } };
          cell.font = { ...font, bold: true, color: { argb: tint[1] } };
        }
        if (/^(Goals|Yellow cards|Red cards|Matches left on current ban|Matches left)$/.test(h) && Number(v) > 0) {
          cell.font = { ...font, bold: true, color: { argb: h.startsWith('Red') || h.startsWith('Matches') ? 'FFA52020' : GREEN } };
        }
        if (h !== 'Player ID') widths[ci] = Math.max(widths[ci], Math.min(len, 42));
        else widths[ci] = 12;
      });
      row.height = 20;
    });

    ws.columns = widths.map((w, i) => ({ width: Math.max(10, w + (NUMERIC.test(s.header[i]) ? 3 : 4)) }));
    // Long names/notes keep their column width but never get cut off in print.
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols } };
    ws.pageSetup = {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:4',
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
    };
    ws.headerFooter.oddFooter = '&LMadang Soccer Association&CPage &P of &N&R&D';
    if (s.rows.length === 0) {
      ws.mergeCells(`A5:${last}5`);
      ws.getCell('A5').value = 'Nothing recorded.';
      ws.getCell('A5').font = { ...font, italic: true, color: { argb: GREY } };
      ws.getCell('A5').alignment = { indent: 1 };
    }
  }
}

