import type { SheetInput } from './import';

/**
 * Reads an .xlsx (all sheets) into plain string grids. Runs in the browser
 * (admin upload) and in tests. Only cell text is kept — no formulas, macros
 * or styles are sent to the server.
 */
export async function readWorkbook(data: ArrayBuffer, limits = { maxSheets: 30, maxRows: 5000, maxCols: 40 }): Promise<SheetInput[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const sheets: SheetInput[] = [];
  let total = 0;
  for (const ws of wb.worksheets.slice(0, limits.maxSheets)) {
    const rows: string[][] = [];
    const last = Math.min(ws.actualRowCount ? ws.rowCount : 0, limits.maxRows - total);
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      const width = Math.min(row.cellCount, limits.maxCols);
      for (let c = 1; c <= width; c++) {
        let text = '';
        try {
          text = row.getCell(c).text ?? '';
        } catch {
          text = '';
        }
        cells.push(String(text));
      }
      rows.push(cells);
    }
    total += rows.length;
    sheets.push({ name: ws.name.slice(0, 80), rows });
  }
  return sheets;
}
