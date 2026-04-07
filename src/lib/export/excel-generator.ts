// ===========================================
// TESTARA — Professional Excel Report Generator
// Uses ExcelJS (pure Node.js — works on Vercel)
// Generates color-coded .xlsx with 3 sheets
// ===========================================

import ExcelJS from "exceljs";

// ===== COLOR SCHEME =====
const COLORS = {
  header_bg: "1A1A2E",
  header_text: "FFFFFF",
  subheader_bg: "16213E",
  title_bg: "0F3460",
  light_gray: "F5F5F5",
  border: "D0D0D0",

  critical_bg: "FFE0E0", critical_text: "CC0000",
  high_bg: "FFF0E0",     high_text: "CC6600",
  medium_bg: "FFFDE0",   medium_text: "998800",
  low_bg: "E0F0FF",      low_text: "0066CC",

  positive_bg: "E8F5E9", positive_text: "2E7D32",
  negative_bg: "FFEBEE",  negative_text: "C62828",
  edge_bg: "FFF3E0",     edge_text: "E65100",
};

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  critical: { bg: COLORS.critical_bg, text: COLORS.critical_text },
  high: { bg: COLORS.high_bg, text: COLORS.high_text },
  medium: { bg: COLORS.medium_bg, text: COLORS.medium_text },
  low: { bg: COLORS.low_bg, text: COLORS.low_text },
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  Positive: { bg: COLORS.positive_bg, text: COLORS.positive_text },
  Negative: { bg: COLORS.negative_bg, text: COLORS.negative_text },
  "Edge Case": { bg: COLORS.edge_bg, text: COLORS.edge_text },
};

function headerStyle(): Partial<ExcelJS.Style> {
  return {
    font: { name: "Arial", bold: true, color: { argb: "FF" + COLORS.header_text }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + COLORS.header_bg } },
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
    border: thinBorder(),
  };
}

function subHeaderStyle(): Partial<ExcelJS.Style> {
  return {
    font: { name: "Arial", bold: true, color: { argb: "FF" + COLORS.header_text }, size: 10 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + COLORS.subheader_bg } },
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
    border: thinBorder(),
  };
}

function dataStyle(wrap = false): Partial<ExcelJS.Style> {
  return {
    font: { name: "Arial", size: 10 },
    alignment: { vertical: "top", wrapText: wrap },
    border: thinBorder(),
  };
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF" + COLORS.border } };
  return { top: side, bottom: side, left: side, right: side };
}

function priorityStyle(priority: string): Partial<ExcelJS.Style> {
  const c = PRIORITY_COLORS[priority.toLowerCase()] || PRIORITY_COLORS.medium;
  return {
    font: { name: "Arial", bold: true, size: 10, color: { argb: "FF" + c.text } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + c.bg } },
    alignment: { horizontal: "center", vertical: "middle" },
    border: thinBorder(),
  };
}

function categoryStyle(category: string): Partial<ExcelJS.Style> {
  const c = CATEGORY_COLORS[category] || CATEGORY_COLORS["Edge Case"];
  return {
    font: { name: "Arial", bold: true, size: 10, color: { argb: "FF" + c.text } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + c.bg } },
    alignment: { horizontal: "center", vertical: "middle" },
    border: thinBorder(),
  };
}

// ===== MAIN GENERATOR =====
export async function generateTestReport(
  tests: Array<Record<string, unknown>>,
  projectName: string,
  mix: Record<string, unknown>
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Testara AI";
  wb.created = new Date();

  // ===== SHEET 1: SUMMARY =====
  const ws1 = wb.addWorksheet("Test Summary", { properties: { tabColor: { argb: "FF4A90D9" } } });

  // Title
  ws1.mergeCells("A1:J1");
  const titleCell = ws1.getCell("A1");
  titleCell.value = "TESTARA — Test Case Report";
  titleCell.font = { name: "Arial", bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + COLORS.header_bg } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws1.getRow(1).height = 40;

  // Metadata
  const meta = [
    ["Project:", projectName],
    ["Generated:", new Date().toLocaleString("en-IN")],
    ["Total Test Cases:", String(tests.length)],
    ["Total Steps:", String(tests.reduce((sum: number, t: Record<string, unknown>) => sum + (t.step_count || t.steps?.length || 0), 0))],
  ];
  meta.forEach(([label, value], i) => {
    ws1.getCell(`A${i + 3}`).value = label;
    ws1.getCell(`A${i + 3}`).font = { name: "Arial", bold: true, size: 10, color: { argb: "FF666666" } };
    ws1.getCell(`B${i + 3}`).value = value;
    ws1.getCell(`B${i + 3}`).font = { name: "Arial", size: 10 };
  });

  // Distribution
  const dist = mix?.distribution || {};
  let row = 8;
  ws1.getCell(`A${row}`).value = "Test Distribution:";
  ws1.getCell(`A${row}`).font = { name: "Arial", bold: true, size: 10 };
  for (const [cat, count] of Object.entries(dist)) {
    row++;
    const catCell = ws1.getCell(`A${row}`);
    catCell.value = `  ${cat}`;
    Object.assign(catCell, { style: categoryStyle(cat as string) });
    ws1.getCell(`B${row}`).value = count as number;
  }

  // Coverage score
  const score = mix?.score || 0;
  row += 2;
  ws1.getCell(`A${row}`).value = "Coverage Score:";
  ws1.getCell(`A${row}`).font = { name: "Arial", bold: true, size: 10 };
  const scoreCell = ws1.getCell(`B${row}`);
  scoreCell.value = `${score}/100`;
  scoreCell.font = {
    name: "Arial", bold: true, size: 12,
    color: { argb: score >= 80 ? "FF2E7D32" : score >= 60 ? "FFE65100" : "FFC62828" },
  };

  // Warnings
  const warnings = mix?.warnings || [];
  if (warnings.length > 0) {
    row += 2;
    ws1.getCell(`A${row}`).value = "Warnings:";
    ws1.getCell(`A${row}`).font = { name: "Arial", bold: true, size: 10, color: { argb: "FFCC6600" } };
    for (const w of warnings) {
      row++;
      ws1.getCell(`A${row}`).value = `  ⚠ ${w}`;
      ws1.getCell(`A${row}`).font = { name: "Arial", size: 9, color: { argb: "FFCC6600" } };
    }
  }

  // Summary table
  row += 3;
  const headers = ["TC ID", "Title", "Category", "Type", "Priority", "Steps", "Assertions", "Status", "Confidence", "Description"];
  headers.forEach((h, col) => {
    const cell = ws1.getCell(row, col + 1);
    cell.value = h;
    Object.assign(cell, { style: headerStyle() });
  });
  ws1.getRow(row).height = 25;

  tests.forEach((test: Record<string, unknown>, idx: number) => {
    row++;
    const tcId = test.tc_id || `TC-${String(idx + 1).padStart(3, "0")}`;
    const category = test.category || "Positive";
    const priority = test.priority || "medium";
    const values = [
      tcId, test.title || "", category, test.type || "happy_path",
      priority.toUpperCase(), test.step_count || test.steps?.length || 0,
      test.has_assertions ? "Yes" : "No", test.status || "draft",
      test.confidence ? `${test.confidence}%` : "N/A", test.description || "",
    ];

    values.forEach((val, col) => {
      const cell = ws1.getCell(row, col + 1);
      cell.value = val;
      Object.assign(cell, { style: dataStyle(col === 9) });

      if (col === 4) Object.assign(cell, { style: priorityStyle(priority) });
      if (col === 2) Object.assign(cell, { style: categoryStyle(category) });
      if (idx % 2 === 1 && col !== 2 && col !== 4) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + COLORS.light_gray } };
      }
    });
  });

  // Column widths
  [10, 40, 12, 14, 12, 8, 10, 10, 12, 50].forEach((w, i) => {
    ws1.getColumn(i + 1).width = w;
  });

  // ===== SHEET 2: DETAILED STEPS =====
  const ws2 = wb.addWorksheet("Detailed Steps", { properties: { tabColor: { argb: "FF6B5CE7" } } });
  let dRow = 1;

  tests.forEach((test: Record<string, unknown>, idx: number) => {
    const tcId = test.tc_id || `TC-${String(idx + 1).padStart(3, "0")}`;
    const priority = test.priority || "medium";
    const category = test.category || "Positive";

    // Test header bar
    ws2.mergeCells(dRow, 1, dRow, 8);
    const hCell = ws2.getCell(dRow, 1);
    hCell.value = `${tcId}: ${test.title || ""}  [${priority.toUpperCase()}] [${category}]`;
    hCell.font = { name: "Arial", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    hCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + COLORS.title_bg } };
    hCell.alignment = { vertical: "middle" };
    ws2.getRow(dRow).height = 28;
    dRow++;

    if (test.description) {
      ws2.getCell(dRow, 1).value = "Description:";
      ws2.getCell(dRow, 1).font = { name: "Arial", bold: true, size: 9, color: { argb: "FF666666" } };
      ws2.getCell(dRow, 2).value = test.description;
      ws2.getCell(dRow, 2).font = { name: "Arial", size: 9 };
      dRow++;
    }
    if (test.preconditions) {
      ws2.getCell(dRow, 1).value = "Preconditions:";
      ws2.getCell(dRow, 1).font = { name: "Arial", bold: true, size: 9, color: { argb: "FF666666" } };
      ws2.getCell(dRow, 2).value = test.preconditions;
      ws2.getCell(dRow, 2).font = { name: "Arial", size: 9 };
      dRow++;
    }
    dRow++;

    // Step headers
    const stepHeaders = ["Step #", "Action", "Smart Locator", "Description", "Input Data", "Expected Result", "Strategy", "Notes"];
    stepHeaders.forEach((h, col) => {
      const cell = ws2.getCell(dRow, col + 1);
      cell.value = h;
      Object.assign(cell, { style: subHeaderStyle() });
    });
    ws2.getRow(dRow).height = 22;
    dRow++;

    // Steps
    const steps = (test.steps || []).sort((a: Record<string, unknown>, b: Record<string, unknown>) => (a.order_index || 0) - (b.order_index || 0));
    steps.forEach((step: Record<string, unknown>) => {
      const fb = step.target?.fallback_selectors || {};
      const role = fb.accessibility_role || "";
      const name = fb.aria_label || fb.text || "";

      let smartLoc = step.target?.selector || "";
      let strategy = "css_fallback";

      if (role && role !== "generic" && name) {
        smartLoc = `getByRole('${role}', { name: '${name}' })`;
        strategy = "getByRole";
      } else if (fb.label || fb.nearest_label) {
        smartLoc = `getByLabel('${fb.label || fb.nearest_label}')`;
        strategy = "getByLabel";
      } else if (fb.placeholder) {
        smartLoc = `getByPlaceholder('${fb.placeholder}')`;
        strategy = "getByPlaceholder";
      } else if (fb.text) {
        smartLoc = `getByText('${fb.text}')`;
        strategy = "getByText";
      } else if (fb.data_testid) {
        smartLoc = `getByTestId('${fb.data_testid}')`;
        strategy = "getByTestId";
      }

      const vals = [
        step.order_index || "", step.action_type || "", smartLoc,
        step.target?.description || "", step.input_data || "",
        step.expected_result || "", strategy, "",
      ];
      vals.forEach((v, col) => {
        const cell = ws2.getCell(dRow, col + 1);
        cell.value = String(v || "");
        Object.assign(cell, { style: dataStyle([2, 3, 4, 5].includes(col)) });
      });
      dRow++;
    });
    dRow += 2;
  });

  [8, 16, 45, 30, 25, 30, 16, 20].forEach((w, i) => { ws2.getColumn(i + 1).width = w; });

  // ===== SHEET 3: PRIORITY MATRIX =====
  const ws3 = wb.addWorksheet("Priority Matrix", { properties: { tabColor: { argb: "FFE74C3C" } } });
  ws3.getCell("A1").value = "Priority Matrix";
  ws3.getCell("A1").font = { name: "Arial", bold: true, size: 14 };

  const priorities: Record<string, any[]> = { critical: [], high: [], medium: [], low: [] };
  tests.forEach((t: Record<string, unknown>) => {
    const p = (t.priority || "medium").toLowerCase();
    if (priorities[p]) priorities[p].push(t);
  });

  let pRow = 3;
  for (const [priority, pTests] of Object.entries(priorities)) {
    ws3.mergeCells(pRow, 1, pRow, 4);
    const pCell = ws3.getCell(pRow, 1);
    pCell.value = `${priority.toUpperCase()} (${pTests.length})`;
    Object.assign(pCell, { style: priorityStyle(priority) });
    pRow++;

    if (pTests.length > 0) {
      ["TC ID", "Title", "Type", "Category"].forEach((h, col) => {
        ws3.getCell(pRow, col + 1).value = h;
        ws3.getCell(pRow, col + 1).font = { name: "Arial", bold: true, size: 9 };
      });
      pRow++;

      pTests.forEach((t: Record<string, unknown>) => {
        ws3.getCell(pRow, 1).value = t.tc_id || "";
        ws3.getCell(pRow, 2).value = t.title || "";
        ws3.getCell(pRow, 3).value = t.type || "";
        const catCell = ws3.getCell(pRow, 4);
        catCell.value = t.category || "";
        Object.assign(catCell, { style: categoryStyle(t.category || "Edge Case") });
        pRow++;
      });
    } else {
      ws3.getCell(pRow, 1).value = "(none)";
      ws3.getCell(pRow, 1).font = { name: "Arial", size: 9, color: { argb: "FF999999" } };
      pRow++;
    }
    pRow++;
  }

  [15, 50, 18, 15].forEach((w, i) => { ws3.getColumn(i + 1).width = w; });

  // Generate buffer
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
