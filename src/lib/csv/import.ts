import Papa from 'papaparse';
import crypto from 'node:crypto';

/**
 * Participant CSV import.
 *
 * Handles sheets shaped like
 *   SR.NO | ID | NAMES | Team Name | PHONE NO: | E-MAIL | GENDER | COLLEGE | CITY | BRANCH | YEAR | DATE/TIME
 * where one team spans consecutive rows and group-level cells (SR.NO, ID,
 * Team Name, DATE/TIME, often COLLEGE/CITY) were merged in the spreadsheet,
 * so they export as blanks on the 2nd+ member rows.
 *
 * Rules:
 * - Headers are matched case-/punctuation-insensitively with aliases; title
 *   rows above the header are skipped. BOM, CRLF and quoted fields are fine.
 * - A row starts a NEW entry when it has its own SR.NO or ID, or (if the
 *   sheet has neither) its own team name. A row with all of those blank
 *   continues the previous entry.
 * - Only group-level fields are inherited (ID, team name, and college/city
 *   when blank). Name, email, phone, gender, branch and year are NEVER
 *   copied between members, and missing contact details stay missing.
 * - "Wide" sheets with Member 2 Name/Email/Phone columns are supported too.
 * - Entries without an ID get a stable synthetic id from their content, so
 *   importing the same file twice never creates duplicates.
 */

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 3000;
export const MAX_TEAM_SIZE = 2;

export type FieldKey =
  | 'sr_no' | 'registration_id' | 'full_name' | 'team_name' | 'phone' | 'email'
  | 'gender' | 'college' | 'city' | 'branch' | 'study_year' | 'registered_at'
  | 'member2_name' | 'member2_email' | 'member2_phone';

export const FIELD_LABELS: Record<FieldKey, string> = {
  sr_no: 'Serial no.', registration_id: 'Registration ID', full_name: 'Name', team_name: 'Team name',
  phone: 'Phone', email: 'Email', gender: 'Gender', college: 'College', city: 'City', branch: 'Branch',
  study_year: 'Year', registered_at: 'Registered at', member2_name: 'Member 2 name',
  member2_email: 'Member 2 email', member2_phone: 'Member 2 phone',
};

const ALIASES: Record<FieldKey, string[]> = {
  sr_no: ['srno', 'sno', 'serialno', 'serialnumber', 'sr', 'slno', 'no'],
  registration_id: ['id', 'registrationid', 'regid', 'registrationno', 'registrationnumber', 'regno', 'teamid', 'uniqueid', 'participantid'],
  full_name: ['names', 'name', 'fullname', 'participantname', 'participantsname', 'studentname', 'member1name', 'membername', 'leadername', 'teamleadername'],
  team_name: ['teamname', 'team'],
  phone: ['phoneno', 'phone', 'phonenumber', 'mobileno', 'mobile', 'mobilenumber', 'contactno', 'contactnumber', 'contact', 'whatsappno', 'member1phone'],
  email: ['email', 'emailid', 'emailaddress', 'mail', 'mailid', 'member1email'],
  gender: ['gender', 'sex'],
  college: ['college', 'collegename', 'institute', 'institution', 'university', 'organisation', 'organization'],
  city: ['city', 'location', 'town'],
  branch: ['branch', 'department', 'dept', 'stream', 'course'],
  study_year: ['year', 'yearofstudy', 'studyyear', 'currentyear', 'semester'],
  registered_at: ['datetime', 'date', 'timestamp', 'registeredat', 'registrationdate', 'time'],
  member2_name: ['member2name', 'secondmembername', 'teammate', 'teammatename', 'partnername'],
  member2_email: ['member2email', 'member2emailid', 'secondmemberemail', 'teammateemail', 'partneremail'],
  member2_phone: ['member2phone', 'member2phoneno', 'member2mobile', 'secondmemberphone', 'teammatephone', 'partnerphone'],
};

export type ColumnMapping = Partial<Record<FieldKey, string>>;

export interface ImportMember {
  position: number;
  full_name: string;
  email: string;
  phone: string;
  gender: string;
  college: string;
  city: string;
  branch: string;
  study_year: string;
  source_row: number;
}

export interface ImportEntry {
  registration_id: string;
  registration_id_generated: boolean;
  team_name: string;
  members: ImportMember[];
  first_row: number;
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  headers: string[];
  mapping: ColumnMapping;
  headerRow: number;
  totalDataRows: number;
  entries: ImportEntry[];
  validEntries: ImportEntry[];
  invalidEntries: ImportEntry[];
  fileErrors: string[];
  warnings: string[];
}

export const normHeader = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const PLACEHOLDER = /^(?:[-–—_.\s]+|n\/?a|nil|none|null)$/i;
const clean = (v: unknown) => String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

export function normalizePhone(raw: string): string {
  const v = clean(raw);
  if (!v) return '';
  const plus = v.startsWith('+');
  const digits = v.replace(/\D/g, '');
  // Spreadsheets sometimes turn numbers into 9.87654321E+09; keep as typed if so.
  if (/e\+?\d+/i.test(v)) return v;
  return (plus ? '+' : '') + digits;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const key of Object.keys(ALIASES) as FieldKey[]) {
    const match = headers.find((h) => !used.has(h) && ALIASES[key].includes(normHeader(h)));
    if (match) {
      mapping[key] = match;
      used.add(match);
    }
  }
  return mapping;
}

/** Finds the header row: the first row in the first 15 that matches a name column plus one other known field. */
function findHeaderRow(rows: string[][]): number {
  const all = new Set(Object.values(ALIASES).flat());
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] ?? []).map(normHeader);
    const hasName = cells.some((c) => ALIASES.full_name.includes(c));
    const known = cells.filter((c) => all.has(c)).length;
    if (hasName && known >= 2) return i;
  }
  return rows.findIndex((r) => r.some((c) => clean(c)));
}

/**
 * Stable ID for an entry without one. Based on the member names only, so
 * filling in a missing email, phone or team name later and re-uploading the
 * sheet updates the same entry instead of creating a duplicate.
 */
function syntheticId(_team: string, members: ImportMember[]): string {
  const basis = members.map((m) => m.full_name.toLowerCase().replace(/\s+/g, ' ').trim()).join('||');
  return 'AUTO-' + crypto.createHash('sha256').update(basis).digest('hex').slice(0, 12).toUpperCase();
}

export function parseParticipantsCsv(csvText: string, overrides: ColumnMapping = {}): ImportPreview {
  const fileErrors: string[] = [];
  const warnings: string[] = [];
  const empty = (headers: string[] = [], mapping: ColumnMapping = {}): ImportPreview => ({
    headers, mapping, headerRow: 0, totalDataRows: 0, entries: [], validEntries: [], invalidEntries: [], fileErrors, warnings,
  });

  if (Buffer.byteLength(csvText, 'utf8') > MAX_CSV_BYTES) {
    fileErrors.push(`File is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB.`);
    return empty();
  }
  const text = csvText.replace(/^﻿/, '');
  if (text.includes('\u0000')) {
    fileErrors.push('This does not look like a text CSV file. Export the sheet as CSV (UTF-8) and try again.');
    return empty();
  }

  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
  const rows = (parsed.data as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? '')));
  if (rows.length === 0) {
    fileErrors.push('The file is empty.');
    return empty();
  }

  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) {
    fileErrors.push('Could not find a header row.');
    return empty();
  }
  const headers = (rows[headerIndex] ?? []).map((h) => clean(h));
  const mapping: ColumnMapping = { ...autoDetectMapping(headers) };
  for (const [k, v] of Object.entries(overrides) as [FieldKey, string | undefined][]) {
    if (v === undefined) continue;
    if (v === '') delete mapping[k];
    else if (headers.includes(v)) mapping[k] = v;
  }
  if (!mapping.full_name) {
    fileErrors.push('No name column found. Expected a header such as "NAMES" or "Name".');
    return empty(headers, mapping);
  }

  const col = (key: FieldKey) => (mapping[key] ? headers.indexOf(mapping[key]!) : -1);
  const idx = Object.fromEntries((Object.keys(ALIASES) as FieldKey[]).map((k) => [k, col(k)])) as Record<FieldKey, number>;
  // Placeholder cells ("-", "—", "NA", "nil"…) count as blank, so they never become an ID, email or phone.
  const get = (row: string[], key: FieldKey) => {
    const v = idx[key] >= 0 ? clean(row[idx[key]]) : '';
    return PLACEHOLDER.test(v) ? '' : v;
  };

  const dataRows = rows.slice(headerIndex + 1);
  if (dataRows.length > MAX_ROWS) {
    fileErrors.push(`Too many rows (${dataRows.length}). The limit is ${MAX_ROWS}.`);
    return empty(headers, mapping);
  }

  const groupKeysPresent = idx.sr_no >= 0 || idx.registration_id >= 0;
  const entries: ImportEntry[] = [];
  let current: ImportEntry | null = null;
  let currentSr = '';
  let groupCollege = '';
  let groupCity = '';
  let totalDataRows = 0;

  dataRows.forEach((row, i) => {
    const rowNumber = headerIndex + i + 2; // 1-based spreadsheet row
    if (!row.some((c) => clean(c))) return; // blank line
    totalDataRows += 1;

    const sr = get(row, 'sr_no');
    const id = get(row, 'registration_id');
    const team = get(row, 'team_name');
    const name = get(row, 'full_name');

    let startsNew: boolean;
    let mergedIdWarning = false;
    if (!current) {
      startsNew = true;
    } else if (!groupKeysPresent) {
      startsNew = team !== '' && team.toLowerCase() !== current.team_name.toLowerCase();
    } else if (id !== '' && id === current.registration_id && sr !== '' && sr !== currentSr && name !== '' && current.members.length >= MAX_TEAM_SIZE) {
      startsNew = true; // a full team already has this ID: a new team whose ID was copied by mistake (fixed below)
    } else if (id !== '' && id === current.registration_id) {
      startsNew = false; // same team ID repeated on each member row
    } else if (sr !== '' && sr !== currentSr) {
      startsNew = true;
    } else if (id !== '' && id !== current.registration_id) {
      // A different ID on a row whose serial no. and team cells are blank
      // (merged) most likely belongs to the same team; flag it for review.
      if (idx.sr_no >= 0 && sr === '' && team === '' && current.registration_id !== '') {
        startsNew = false;
        mergedIdWarning = true;
      } else {
        startsNew = true;
      }
    } else {
      startsNew = false; // all group cells blank → continuation row
    }

    if (startsNew) {
      current = {
        registration_id: id,
        registration_id_generated: false,
        team_name: team,
        members: [],
        first_row: rowNumber,
        errors: [],
        warnings: [],
      };
      currentSr = sr;
      groupCollege = '';
      groupCity = '';
      entries.push(current);
    } else if (current) {
      if (mergedIdWarning) {
        current.warnings.push(`Row ${rowNumber}: has its own ID "${id}" but blank serial/team cells — grouped with entry "${current.registration_id}". Check this team.`);
      }
      if (id && !current.registration_id) current.registration_id = id;
      if (team && !current.team_name) current.team_name = team;
      if (team && current.team_name && team.toLowerCase() !== current.team_name.toLowerCase()) {
        current.warnings.push(`Row ${rowNumber}: team name "${team}" differs from "${current.team_name}" on the same entry.`);
      }
    }
    const entry = current!;

    const college = get(row, 'college') || groupCollege;
    const city = get(row, 'city') || groupCity;
    groupCollege = college;
    groupCity = city;

    if (name) {
      entry.members.push({
        position: entry.members.length + 1,
        full_name: name,
        email: get(row, 'email').toLowerCase(),
        phone: normalizePhone(get(row, 'phone')),
        gender: get(row, 'gender'),
        college,
        city,
        branch: get(row, 'branch'),
        study_year: get(row, 'study_year'),
        source_row: rowNumber,
      });
    } else if (get(row, 'email') || get(row, 'phone')) {
      entry.errors.push(`Row ${rowNumber}: has contact details but no name.`);
    }

    const m2 = get(row, 'member2_name');
    if (m2) {
      entry.members.push({
        position: entry.members.length + 1,
        full_name: m2,
        email: get(row, 'member2_email').toLowerCase(),
        phone: normalizePhone(get(row, 'member2_phone')),
        gender: '', college, city, branch: '', study_year: '',
        source_row: rowNumber,
      });
    }
  });

  // Validation
  const idFirstSeen = new Map<string, number>();
  const emailOwner = new Map<string, number>();
  entries.forEach((entry, entryIndex) => {
    if (entry.members.length === 0) entry.errors.push(`Row ${entry.first_row}: no participant name.`);
    if (entry.members.length > MAX_TEAM_SIZE) entry.errors.push(`Row ${entry.first_row}: ${entry.members.length} members — the maximum team size is ${MAX_TEAM_SIZE}. Check that teams are separated correctly.`);
    entry.members.forEach((m, i) => {
      m.position = i + 1;
      if (m.full_name.length > 120) entry.errors.push(`Row ${m.source_row}: name is too long.`);
      if (m.email && !EMAIL_RE.test(m.email)) entry.warnings.push(`Row ${m.source_row}: "${m.email}" does not look like a valid email.`);
      if (!m.email) entry.warnings.push(`Row ${m.source_row}: ${m.full_name} has no email.`);
      if (!m.phone) entry.warnings.push(`Row ${m.source_row}: ${m.full_name} has no phone number.`);
      else if (!/e/i.test(m.phone) && (m.phone.replace(/\D/g, '').length < 10 || m.phone.replace(/\D/g, '').length > 13)) {
        entry.warnings.push(`Row ${m.source_row}: phone "${m.phone}" has an unusual length.`);
      }
      if (m.email) {
        const owner = emailOwner.get(m.email);
        if (owner !== undefined && owner !== entryIndex) entry.warnings.push(`Row ${m.source_row}: email ${m.email} also appears in another entry.`);
        else emailOwner.set(m.email, entryIndex);
      }
    });
    if (entry.team_name.length > 120) entry.errors.push(`Row ${entry.first_row}: team name is too long.`);

    if (!entry.registration_id) {
      entry.registration_id = syntheticId(entry.team_name, entry.members);
      entry.registration_id_generated = true;
    } else if (entry.registration_id.length > 100) {
      entry.errors.push(`Row ${entry.first_row}: registration ID is too long.`);
    }
    const seen = idFirstSeen.get(entry.registration_id);
    if (seen !== undefined) {
      // A copied ID in the sheet should not block the whole import: give this
      // team a derived ID (same every time the sheet is uploaded) and flag it.
      const original = entry.registration_id;
      let n = 2;
      while (idFirstSeen.has(`${original}-${n}`)) n += 1;
      entry.registration_id = `${original}-${n}`;
      entry.warnings.push(`Row ${entry.first_row}: registration ID "${original}" is also used by the entry on row ${seen}; this team was given "${entry.registration_id}". Correct the ID in the sheet if one is wrong.`);
      idFirstSeen.set(entry.registration_id, entry.first_row);
    } else {
      idFirstSeen.set(entry.registration_id, entry.first_row);
    }
  });

  if (idx.registration_id < 0) warnings.push('No ID column found — stable IDs were generated from team and member details.');
  if (idx.email < 0) warnings.push('No email column found.');
  if (idx.phone < 0) warnings.push('No phone column found.');

  return {
    headers,
    mapping,
    headerRow: headerIndex + 1,
    totalDataRows,
    entries,
    validEntries: entries.filter((e) => e.errors.length === 0),
    invalidEntries: entries.filter((e) => e.errors.length > 0),
    fileErrors,
    warnings,
  };
}
