import Papa from 'papaparse';

export interface ColumnMapping {
  registration_id: string;
  team_name?: string;
  member1_name: string;
  member1_email?: string;
  member1_phone?: string;
  member2_name?: string;
  member2_email?: string;
  member2_phone?: string;
  payment_status?: string;
}

export interface ParsedRow {
  rowIndex: number;
  raw: Record<string, string>;
  registration_id?: string;
  team_name?: string;
  member1_name?: string;
  member1_email?: string;
  member1_phone?: string;
  member2_name?: string;
  member2_email?: string;
  member2_phone?: string;
  payment_status?: string;
  errors: string[];
}

export interface ImportPreview {
  headers: string[];
  totalRows: number;
  validRows: ParsedRow[];
  invalidRows: ParsedRow[];
  duplicateRegistrationIds: string[];
}

/** Remove title/blank rows before the real header (common in Google Sheets exports). */
export function normalizeCsvText(csvText: string): string {
  const parsed = Papa.parse<string[]>(csvText, { header: false, skipEmptyLines: false });
  const rows = parsed.data;
  const norm = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(norm);
    return cells.includes('names') && cells.includes('id') && (cells.includes('srno') || cells.includes('email') || cells.includes('emailid'));
  });
  return Papa.unparse(headerIndex >= 0 ? rows.slice(headerIndex) : rows.filter((row) => row.some((cell) => String(cell ?? '').trim())));
}

/** Step 1: just parse headers + raw rows, no mapping applied yet. */
export function parseCsvHeaders(csvText: string): { headers: string[]; rowCount: number } {
  const result = Papa.parse<Record<string, string>>(normalizeCsvText(csvText), { header: true, skipEmptyLines: true });
  return { headers: result.meta.fields ?? [], rowCount: result.data.length };
}

/** Step 2: apply the admin-confirmed column mapping and validate. */
export function applyMappingAndValidate(csvText: string, mapping: ColumnMapping): ImportPreview {
  const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const headers = result.meta.fields ?? [];

  // Google Sheets exports merged team/ID cells as blanks on continuation rows.
  // Fill down ID/team and fold a second consecutive member row into the same entry.
  const normalizedRows = result.data.map((row) => ({ ...row }));
  let lastRegistrationId = '';
  let lastTeamName = '';
  for (const raw of normalizedRows) {
    const id = (raw[mapping.registration_id] ?? '').trim();
    const continuationRow = !id && Boolean(lastRegistrationId);
    if (id) lastRegistrationId = id;
    else if (lastRegistrationId) raw[mapping.registration_id] = lastRegistrationId;
    if (mapping.team_name) {
      const team = (raw[mapping.team_name] ?? '').trim();
      if (team) lastTeamName = team;
      else if (continuationRow && lastTeamName) raw[mapping.team_name] = lastTeamName;
      else if (!continuationRow) lastTeamName = '';
    }
  }
  const foldedRows: Record<string, string>[] = [];
  for (const raw of normalizedRows) {
    const id = (raw[mapping.registration_id] ?? '').trim();
    const name = (raw[mapping.member1_name] ?? '').trim();
    const previous = foldedRows[foldedRows.length - 1];
    if (id && previous && (previous[mapping.registration_id] ?? '').trim() === id && name) {
      const existingSecond = mapping.member2_name ? (previous[mapping.member2_name] ?? '').trim() : '';
      if (!existingSecond && mapping.member2_name) {
        previous[mapping.member2_name] = name;
        if (mapping.member2_email) previous[mapping.member2_email] = mapping.member1_email ? (raw[mapping.member1_email] ?? '') : '';
        if (mapping.member2_phone) previous[mapping.member2_phone] = mapping.member1_phone ? (raw[mapping.member1_phone] ?? '') : '';
        continue;
      }
    }
    foldedRows.push(raw);
  }

  const seen = new Map<string, number>();
  const rows: ParsedRow[] = foldedRows.map((raw, i) => {
    const errors: string[] = [];
    const registration_id = (raw[mapping.registration_id] ?? '').trim();
    const member1_name = (raw[mapping.member1_name] ?? '').trim();
    const team_name = mapping.team_name ? (raw[mapping.team_name] ?? '').trim() : undefined;
    const member1_email = mapping.member1_email ? (raw[mapping.member1_email] ?? '').trim() : undefined;
    const member1_phone = mapping.member1_phone ? (raw[mapping.member1_phone] ?? '').trim() : undefined;
    const member2_name = mapping.member2_name ? (raw[mapping.member2_name] ?? '').trim() : undefined;
    const member2_email = mapping.member2_email ? (raw[mapping.member2_email] ?? '').trim() : undefined;
    const member2_phone = mapping.member2_phone ? (raw[mapping.member2_phone] ?? '').trim() : undefined;
    const payment_status = mapping.payment_status ? (raw[mapping.payment_status] ?? '').trim() : undefined;

    if (!registration_id) errors.push('Missing registration_id');
    if (!member1_name) errors.push('Missing member1_name');

    if (registration_id) {
      seen.set(registration_id, (seen.get(registration_id) ?? 0) + 1);
    }

    return {
      rowIndex: i + 2, // +1 for header row, +1 for 1-indexing
      raw,
      registration_id,
      team_name,
      member1_name,
      member1_email,
      member1_phone,
      member2_name,
      member2_email,
      member2_phone,
      payment_status,
      errors,
    };
  });

  const duplicateRegistrationIds = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);

  for (const row of rows) {
    if (row.registration_id && duplicateRegistrationIds.includes(row.registration_id)) {
      row.errors.push('Duplicate registration_id in file');
    }
  }

  return {
    headers,
    totalRows: rows.length,
    validRows: rows.filter((r) => r.errors.length === 0),
    invalidRows: rows.filter((r) => r.errors.length > 0),
    duplicateRegistrationIds,
  };
}

/** Generates the next sequential ENTRY-### code given the highest existing number. */
export function nextEntryCode(currentMax: number): string {
  return `ENTRY-${String(currentMax + 1).padStart(3, '0')}`;
}
