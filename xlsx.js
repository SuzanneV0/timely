/* Minimal dependency-free .xlsx writer (stored zip + SpreadsheetML).
   buildXlsx(sheets) -> Uint8Array
   sheets: [{ name, columns: [{ header, width, type }], rows: [[...]], totals: { label, sumColumns: [idx] } }]
   column types: 'text' | 'wrap' | 'date' | 'time' | 'duration' | 'number'
   date/time/duration values are Excel serial numbers (days). */
(function (root) {
  'use strict';

  const enc = new TextEncoder();

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const DOS_TIME = 0, DOS_DATE = (2024 - 1980) << 9 | 1 << 5 | 1;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = enc.encode(f.content);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true);      // stored
      local.setUint16(10, DOS_TIME, true);
      local.setUint16(12, DOS_DATE, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), name, data);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, DOS_TIME, true);
      cen.setUint16(14, DOS_DATE, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
    let p = 0;
    for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }

  function esc(s) {
    return String(s)
      .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function colLetter(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  // Excel forbids []:*?/\ in sheet names, max 31 chars, must be unique.
  function sheetNames(sheets) {
    const used = new Set();
    return sheets.map((s, i) => {
      let base = String(s.name || '').replace(/[\[\]:*?\/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || `Sheet${i + 1}`;
      let name = base, n = 2;
      while (used.has(name.toLowerCase())) {
        const suffix = ` (${n++})`;
        name = base.slice(0, 31 - suffix.length) + suffix;
      }
      used.add(name.toLowerCase());
      return name;
    });
  }

  // cellXfs indexes
  const STYLE = { text: 0, header: 1, date: 2, time: 3, duration: 4, number: 5, wrap: 6 };
  const BOLD = { text: 7, wrap: 7, date: 7, time: 7, duration: 8, number: 9 };

  const STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3">' +
    '<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>' +
    '<numFmt numFmtId="165" formatCode="h:mm:ss\\ AM/PM"/>' +
    '<numFmt numFmtId="166" formatCode="[h]:mm:ss"/>' +
    '</numFmts>' +
    '<fonts count="3">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF19171C"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="4">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFA88BC1"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE6DDCE"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>' +
    '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="166" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>' +
    '<xf numFmtId="2" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function textCell(ref, value, style) {
    if (value === null || value === undefined || value === '') return `<c r="${ref}" s="${style}"/>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  }

  function sheetXml(sheet) {
    const cols = sheet.columns;
    const lastCol = colLetter(cols.length - 1);
    let rowsXml = '<row r="1" ht="20" customHeight="1">' +
      cols.map((c, i) => textCell(colLetter(i) + '1', c.header, STYLE.header)).join('') + '</row>';

    sheet.rows.forEach((row, ri) => {
      const r = ri + 2;
      rowsXml += `<row r="${r}">` + cols.map((c, i) => {
        const ref = colLetter(i) + r;
        const v = row[i];
        const numeric = c.type === 'date' || c.type === 'time' || c.type === 'duration' || c.type === 'number';
        if (numeric && typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="${STYLE[c.type]}"><v>${v}</v></c>`;
        return textCell(ref, v, STYLE[c.type] === undefined || numeric ? STYLE.text : STYLE[c.type]);
      }).join('') + '</row>';
    });

    const lastDataRow = sheet.rows.length + 1;
    if (sheet.totals && sheet.rows.length) {
      const r = lastDataRow + 1;
      rowsXml += `<row r="${r}">` + cols.map((c, i) => {
        const ref = colLetter(i) + r;
        if (i === 0) return textCell(ref, sheet.totals.label || 'Total', BOLD.text);
        if (sheet.totals.sumColumns.includes(i)) {
          const L = colLetter(i);
          const sum = sheet.rows.reduce((n, row) => n + (typeof row[i] === 'number' ? row[i] : 0), 0);
          return `<c r="${ref}" s="${BOLD[c.type] ?? BOLD.text}"><f>SUM(${L}2:${L}${lastDataRow})</f><v>${sum}</v></c>`;
        }
        return `<c r="${ref}" s="${BOLD.text}"/>`;
      }).join('') + '</row>';
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      '<cols>' + cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join('') + '</cols>' +
      `<sheetData>${rowsXml}</sheetData>` +
      (sheet.rows.length ? `<autoFilter ref="A1:${lastCol}${lastDataRow}"/>` : '') +
      '</worksheet>';
  }

  function buildXlsx(sheets) {
    const names = sheetNames(sheets);
    const files = [
      {
        name: '[Content_Types].xml',
        content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
          '</Types>',
      },
      {
        name: '_rels/.rels',
        content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
      },
      {
        name: 'xl/workbook.xml',
        content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets>' + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>' +
          '<calcPr fullCalcOnLoad="1"/>' +
          '</workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
          `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          '</Relationships>',
      },
      { name: 'xl/styles.xml', content: STYLES_XML },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s) })),
    ];
    return zip(files);
  }

  root.buildXlsx = buildXlsx;
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildXlsx };
})(typeof globalThis !== 'undefined' ? globalThis : this);
