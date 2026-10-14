import { NextResponse } from 'next/server';

/**
 * CSV export helpers. Cells that a spreadsheet would treat as a formula
 * (= + - @, tab, CR) are prefixed with an apostrophe to prevent CSV/formula
 * injection when organizers open the file in Excel or Sheets.
 */
export type Cell = string | number | boolean | null | undefined;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');
}

export function csvResponse(fileName: string, csv: string) {
  return new NextResponse(`﻿${csv}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName.replace(/[^\w.-]/g, '_')}"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
