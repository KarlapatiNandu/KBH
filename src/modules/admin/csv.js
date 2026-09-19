/**
 * A small RFC 4180 CSV reader.
 *
 * The participant importer gets away with `line.split(',')` because roll
 * numbers and names never contain commas. Question text does — routinely —
 * and so do prizes ("₹1,00,000"). So this handles the real grammar: quoted
 * fields, commas and newlines inside quotes, and "" as an escaped quote.
 *
 * Records carry the source line they started on so the importer can point at
 * the offending row in the file the host actually edited.
 */
export function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, ''); // Excel likes to leave a BOM
  const records = [];
  let cells = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => { cells.push(field); field = ''; };
  const endRecord = () => {
    endField();
    // Blank lines are noise, not data — drop them but keep counting lines.
    if (cells.some((c) => c.trim() !== '')) records.push({ cells, line: recordLine });
    cells = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else inQuotes = false;
      } else if (ch === '\r' && src[i + 1] === '\n') {
        field += '\n';                                  // normalise CRLF
        i++;
        line++;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === ',') endField();
    else if (ch === '\r') continue;                     // bare CR before LF
    else if (ch === '\n') {
      endRecord();
      line++;
      recordLine = line;
    } else field += ch;
  }

  endRecord();
  return records;
}

/**
 * Builds a header lookup: canonical field name → column index.
 * `aliases` maps the canonical name to every spelling we accept.
 */
export function mapHeader(headerCells, aliases) {
  const normalised = headerCells.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const index = {};
  for (const [field, names] of Object.entries(aliases)) {
    const at = normalised.findIndex((h) => names.includes(h));
    if (at !== -1) index[field] = at;
  }
  return index;
}

/** Quotes a value only when it needs it, so hand-written CSVs stay readable. */
export function toCsvField(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(toCsvField).join(',')).join('\n');
}
