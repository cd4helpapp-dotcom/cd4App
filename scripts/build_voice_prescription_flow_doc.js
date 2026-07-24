const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  Header, Footer, PageNumber, PageBreak,
} = require('docx');

const out = 'F:/cd4/docs/voice-prescription-medicine-normalization-flow.docx';
const C = { navy: '0B2545', blue: '2E74B5', teal: '087F6B', pale: 'E8EEF5', paleTeal: 'EAF5F2', gray: '555555', red: '9B1C1C' };
const body = (text, opts = {}) => new Paragraph({ spacing: { after: 120, line: 300 }, children: [new TextRun({ text, font: 'Calibri', size: 22, color: C.navy, ...opts })] });
const bullet = (text) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 80, line: 300 }, children: [new TextRun({ text, font: 'Calibri', size: 22, color: C.navy })] });
const number = (text) => new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 80, line: 300 }, children: [new TextRun({ text, font: 'Calibri', size: 22, color: C.navy })] });
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 }, children: [new TextRun({ text, font: 'Calibri', bold: true, size: 32, color: C.blue })] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 140 }, children: [new TextRun({ text, font: 'Calibri', bold: true, size: 26, color: C.blue })] });
const cell = (text, header = false) => new TableCell({ shading: header ? { type: ShadingType.CLEAR, fill: C.pale } : undefined, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ spacing: { after: 0, line: 260 }, children: [new TextRun({ text: String(text), font: 'Calibri', size: 19, bold: header, color: C.navy })] })] });
const table = (headers, rows, widths) => new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: widths, borders: { top: { style: BorderStyle.SINGLE, size: 4, color: 'C8D2DC' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C8D2DC' }, left: { style: BorderStyle.SINGLE, size: 4, color: 'C8D2DC' }, right: { style: BorderStyle.SINGLE, size: 4, color: 'C8D2DC' }, insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D8E0E7' }, insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'D8E0E7' } }, rows: [new TableRow({ children: headers.map(x => cell(x, true)) }), ...rows.map(row => new TableRow({ children: row.map(x => cell(x)) }))] });
const callout = (label, text, fill = C.paleTeal, color = C.teal) => new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360], rows: [new TableRow({ children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill }, margins: { top: 150, bottom: 150, left: 180, right: 180 }, children: [new Paragraph({ spacing: { after: 0, line: 280 }, children: [new TextRun({ text: label + '  ', bold: true, font: 'Calibri', size: 21, color }), new TextRun({ text, font: 'Calibri', size: 21, color: C.navy })] })] })] })] });

const children = [];
children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Voice Prescription Medicine Normalization Flow', font: 'Calibri', size: 48, bold: true, color: C.navy })] }));
children.push(new Paragraph({ spacing: { after: 180 }, children: [new TextRun({ text: 'How spoken medicine names become safe, reviewable prescription PDF entries', font: 'Calibri', size: 24, italics: true, color: C.gray })] }));
children.push(callout('Recommended approach', 'Use a layered pipeline: voice transcript -> AI normalization -> curated medicine dictionary -> confidence check -> doctor confirmation -> final PDF.'));
children.push(h1('1. Objective'));
children.push(body('The doctor should be able to speak naturally. The system should recognize the medicine name, dose, frequency, duration, and instructions, then place the verified result in the prescription draft and final PDF without creating duplicate or invented medicines.'));
children.push(h1('2. End-to-end workflow'));
[
  "Voice capture: record the doctor's spoken prescription and keep the raw transcript as the source of truth.",
  'Immediate local draft: update the draft instantly using local section routing so the doctor sees progress even when AI is unavailable.',
  'Pause-based AI parsing: after approximately 900 ms of silence, send the accumulated dictation to the parser once; do not call the API for every word.',
  'Clinical extraction: return medicines, dose, frequency, duration, instructions, complaints, history, examination, diagnosis, advice, precautions, follow-up, and red flags.',
  'Dictionary matching: compare the AI result with verified generic names, brand names, aliases, strengths, and dosage forms.',
  'Confidence decision: auto-normalize only when the match is strong; otherwise show a confirmation prompt to the doctor.',
  'Draft reconciliation: prefer the verified AI/dictionary medicine row and use the raw local row only as a fallback. Remove fuzzy duplicates.',
  'Final server validation: parse the final reviewed draft again on the server before generating and sending the PDF.',
  "Audit trail: preserve the doctor's original wording and the normalized medicine result for review and future alias improvements.",
].forEach(x => children.push(number(x)));
children.push(h1('3. Medicine dictionary design'));
children.push(body('The dictionary should be an expandable Supabase table, not a hardcoded list inside the mobile app. Start with a verified starter catalog and grow it through pharmacist/doctor review.'));
children.push(table(['Field', 'Purpose', 'Example'], [['generic_name', 'Standard active ingredient', 'Paracetamol'], ['brand_name', 'Common market brand', 'Dolo'], ['aliases', 'Speech and spelling variants', 'dolo, dolo 650, tolo, pcm'], ['strength', 'Strength or concentration', '650 mg'], ['dosage_form', 'Tablet, syrup, capsule, etc.', 'Tablet'], ['active', 'Whether the entry can be used', 'true'], ['verified_by', 'Doctor/pharmacist review record', 'User ID / review date']], [1900, 3900, 3560]));
children.push(h1('4. Example normalization'));
children.push(table(['Doctor says', 'Normalized result', 'System action'], [['Give Dolo 650', 'Paracetamol / Dolo 650 mg', 'Show as a medicine row'], ['Tolo six-fifty', 'Possible Dolo 650 mg', 'Ask doctor to confirm if confidence is low'], ['PCM BD for 3 days after food', 'Paracetamol 650 mg | twice daily | 3 days | after food', 'Normalize abbreviations and retain all instructions'], ['Temperature 102 Fahrenheit', 'Temperature: 102°F', 'Keep in examination/clinical notes, never as a medicine']], [2700, 3150, 3510]));
children.push(callout('Safety rule', 'If the system cannot confidently identify a medicine, it must not silently guess. Display the spoken text and ask the doctor to confirm the name before the PDF is sent.', 'FCEBEC', C.red));
children.push(h1('5. Confidence and confirmation rules'));
['High confidence: exact generic/brand match plus compatible strength or dosage form. Normalize automatically, but keep the original spoken phrase in the audit trail.', 'Medium confidence: fuzzy alias or speech correction match. Show the suggested medicine and require doctor confirmation.', 'Low confidence: no reliable dictionary match, conflicting strengths, or multiple possible medicines. Do not generate a confirmed medicine row; ask the doctor to edit it.', 'Never treat a temperature, blood pressure, pulse, glucose reading, age, or weight as a medicine merely because it contains a number or unit.'].forEach(x => children.push(bullet(x)));
children.push(h1('6. Current implementation and proposed enhancement'));
children.push(table(['Area', 'Current behavior', 'Next enhancement'], [['Voice draft', 'Updates locally while the doctor speaks.', 'Keep raw transcript and show parsing status.'], ['AI parser', 'Extracts medicines and clinical sections after a pause.', 'Return dictionary match and confidence metadata.'], ['Duplicate control', 'AI rows are preferred over raw local medicine rows; fuzzy duplicate cleanup is applied.', 'Persist confirmed aliases for future recognition.'], ['PDF', 'Server parses the reviewed draft and includes medicine details plus verbatim notes.', 'Block sending when a low-confidence medicine needs confirmation.'], ['Fallback', 'Local routing continues when AI is unavailable.', 'Use a verified local dictionary for offline/common-name matching.']], [1800, 3780, 3780]));
children.push(h1('7. Acceptance checklist'));
['A spoken medicine appears once in the draft and once in the PDF.', 'Medicine name, strength, dose, frequency, duration, and timing instructions remain attached to the same row.', 'Clinical facts such as fever, cough, BP, glucose, pain location, and pregnancy/bleeding details are not converted into medicine rows.', 'AI parsing shows a visible loading/analyzing state and does not overwrite a doctor-edited draft after Stop or Send.', 'Unknown or ambiguous medicine names require doctor confirmation.', "The final PDF retains the doctor's original dictated wording for audit/review.", 'The dictionary can be expanded without shipping a new mobile build.'].forEach(x => children.push(bullet(x)));
children.push(h1('8. Recommended rollout'));
['Phase 1: create the Supabase dictionary table and seed a small doctor-reviewed starter catalog.', 'Phase 2: add fuzzy alias matching and confidence scores to the parser response.', 'Phase 3: add the doctor confirmation UI for medium/low-confidence matches.', 'Phase 4: review correction logs and expand aliases under clinical supervision.'].forEach(x => children.push(number(x)));
children.push(callout('Important', 'This workflow assists documentation; it does not independently prescribe or confirm treatment. The doctor must review and approve the final medicine row before sending the prescription PDF.', 'FFF7E6', '7A5A00'));

const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1152, right: 1440, bottom: 1080, left: 1440 } } }, headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'CD4 | Voice Prescription Workflow', font: 'Calibri', size: 17, color: C.gray })] })] }) }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Internal implementation guide | Doctor review remains mandatory', font: 'Calibri', size: 17, color: C.gray })] })] }) }, children }] });
Packer.toBuffer(doc).then(buffer => { fs.writeFileSync(out, buffer); console.log(out); });
