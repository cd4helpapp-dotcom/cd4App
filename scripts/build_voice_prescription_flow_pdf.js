const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const OUT = 'F:/cd4/output/pdf/voice-prescription-medicine-normalization-flow.pdf';
fs.mkdirSync('F:/cd4/output/pdf', { recursive: true });
const W = 595.28, H = 841.89, M = 42;
const C = { navy: rgb(0.04,0.15,0.27), teal: rgb(0.03,0.48,0.40), blue: rgb(0.18,0.45,0.71), muted: rgb(0.34,0.40,0.43), light: rgb(0.91,0.95,0.98), pale: rgb(0.91,0.97,0.95), red: rgb(0.61,0.11,0.11), gold: rgb(0.48,0.35,0.02), white: rgb(1,1,1), border: rgb(0.78,0.83,0.86), goldFill: rgb(1,0.97,0.90) };
let pdf, regular, bold, page, y;

const newPage = () => { page = pdf.addPage([W,H]); y = H - 48; page.drawRectangle({x:0,y:H-25,width:W,height:25,color:C.teal}); page.drawText('CD4 | Voice Prescription Workflow', {x:W-M-150,y:H-17,size:8,font:regular,color:C.white}); };
const textWidth = (s, size, font=regular) => font.widthOfTextAtSize(s, size);
const wrap = (text, width, size=10, font=regular) => { const words=String(text).split(/\s+/); const lines=[]; let line=''; for(const word of words){const next=line?line+' '+word:word; if(textWidth(next,size,font)>width && line){lines.push(line);line=word;} else line=next;} if(line) lines.push(line); return lines; };
const ensure = (height) => { if(y-height < 45){ newPage(); } };
const para = (text, size=10, color=C.navy, gap=5, font=regular, width=W-2*M) => { const lines=wrap(text,width,size,font); ensure(lines.length*(size+3)+gap); for(const line of lines){page.drawText(line,{x:M,y,size,font,color});y-=size+3;} y-=gap; };
const heading = (text, size=15) => { ensure(28); page.drawText(text,{x:M,y,size,font:bold,color:C.blue}); y-=size+8; };
const bullet = (text, color=C.navy) => { const lines=wrap(text,W-2*M-18,9.5,regular); ensure(lines.length*13+3); lines.forEach((line,i)=>{page.drawText((i?'  ':'- ')+line,{x:M,y,size:9.5,font:regular,color});y-=13;}); y-=3; };
const numbered = (n,text) => { const lines=wrap(text,W-2*M-20,9.5,regular); ensure(lines.length*13+3); lines.forEach((line,i)=>{page.drawText((i? '   ':' '+n+'. ')+line,{x:M,y,size:9.5,font:regular,color:C.navy});y-=13;});y-=3; };
const callout = (label,text,fill=C.pale,labelColor=C.teal) => { const lines=wrap(label+'  '+text,W-2*M-20,9.5,regular); const h=lines.length*13+18; ensure(h); page.drawRectangle({x:M-5,y:y-h+5,width:W-2*M+10,height:h,color:fill,borderColor:C.border,borderWidth:0.7}); lines.forEach((line,i)=>page.drawText(line,{x:M+5,y:y-13-i*13,size:9.5,font:i===0?bold:regular,color:i===0?labelColor:C.navy})); y-=h+8; };
const table = (headers, rows, widths) => { const x0=M, rowH=26, total=widths.reduce((a,b)=>a+b,0); ensure(rowH*(rows.length+1)+8); const drawRow=(vals,header)=>{let x=x0; vals.forEach((val,i)=>{page.drawRectangle({x,y:y-rowH+5,width:widths[i],height:rowH,color:header?C.light:C.white,borderColor:C.border,borderWidth:.5}); const lines=wrap(val,widths[i]-10,8.1,header?bold:regular).slice(0,2); lines.forEach((line,j)=>page.drawText(line,{x:x+5,y:y-13-j*9,size:8.1,font:header?bold:regular,color:C.navy}));x+=widths[i];});y-=rowH;}; drawRow(headers,true); rows.forEach(r=>drawRow(r,false)); y-=8; };

(async()=>{
  pdf=await PDFDocument.create(); regular=await pdf.embedFont(StandardFonts.Helvetica); bold=await pdf.embedFont(StandardFonts.HelveticaBold); newPage();
  page.drawText('Voice Prescription Medicine', {x:M,y,size:25,font:bold,color:C.navy}); y-=31; page.drawText('Normalization, dictionary, and PDF workflow', {x:M,y,size:14,font:regular,color:C.muted}); y-=28;
  callout('Recommended design:', 'Voice transcript -> AI parser -> verified medicine dictionary -> confidence check -> doctor confirmation -> final prescription PDF.');
  heading('1. What the system must do');
  para('The doctor can speak naturally. The system must capture the exact speech, identify the medicine and its instructions, avoid duplicate or invented names, show uncertainty clearly, and put only the doctor-approved result into the final PDF.');
  heading('2. Complete medicine flow');
  [
    'Voice capture stores the raw doctor transcript. This is never discarded.',
    'The local draft updates immediately so the doctor can see the captured prescription.',
    'After about 900 ms of pause, the AI parser analyzes the accumulated text once. It extracts medicine name, strength, dose, frequency, duration, timing, and clinical sections.',
    'The parser sends each medicine candidate to dictionary matching using generic names, brand names, aliases, strength, and dosage form.',
    'A confidence rule decides whether to accept, suggest for confirmation, or reject the match as ambiguous.',
    'The draft prefers the verified AI/dictionary row. Raw speech is only a fallback, so lines such as "Dolo 650" and "like Dolo 650" do not create two rows.',
    'The doctor reviews or edits the draft. Stop and Send invalidate pending AI updates so a late response cannot overwrite the reviewed draft.',
    'The server parses and validates the final reviewed text again, generates the PDF, and keeps doctor verbatim notes as an audit backup.',
  ].forEach((t,i)=>numbered(i+1,t));
  heading('3. Exact database design');
  para('Use two separate tables. The dictionary stores reusable medicine identity data. The prescription table stores what this doctor said for this patient. Do not mix patient-specific dosage instructions into the reusable dictionary.');
  page.drawText('A. medicine_dictionary', {x:M,y,size:12,font:bold,color:C.teal}); y-=18;
  table(['Column','Type / rule','What to store'],[
    ['id','uuid primary key','Stable medicine record ID'],
    ['generic_name','text, required','Active ingredient, e.g. Paracetamol'],
    ['brand_name','text, optional','Market brand, e.g. Dolo'],
    ['aliases','text[]','dolo 650, pcm, tolo 650, speech variants'],
    ['strength_value','numeric, optional','650'],
    ['strength_unit','text, optional','mg, ml, mcg, %'],
    ['dosage_form','text','tablet, syrup, capsule, injection, cream'],
    ['route','text, optional','oral, topical, inhaled, injection'],
    ['market','text','India, or another supported market'],
    ['normalized_key','text, unique','Lowercase matching key for lookup'],
    ['active','boolean','Disable unsafe/outdated entries without deleting history'],
    ['verification_status','text','pending, verified, rejected'],
    ['source_reference','text','Licensed catalog, pharmacist review, or internal source'],
    ['verified_by / verified_at','uuid / timestamp','Who verified the entry and when'],
    ['created_at / updated_at','timestamp','Audit timestamps'],
  ],[130,145,238]);
  page.drawText('B. prescription_medicines', {x:M,y,size:12,font:bold,color:C.teal}); y-=18;
  table(['Column','Type / rule','What to store'],[
    ['id / prescription_id','uuid','Prescription row identity and parent prescription'],
    ['medicine_dictionary_id','uuid, nullable','Matched dictionary record, if any'],
    ['spoken_text','text','Exact phrase spoken by the doctor'],
    ['normalized_name','text','Name shown to the doctor/patient'],
    ['strength / dose','text','650 mg, 1 tablet, etc.'],
    ['frequency','text','OD, BD, TDS, SOS normalized for display'],
    ['duration','text','5 days, 2 weeks, etc.'],
    ['instructions','text','After food, before sleep, and similar instructions'],
    ['confidence_score','numeric','0.00 to 1.00'],
    ['match_type','text','exact, alias, fuzzy, AI_only, unverified'],
    ['doctor_confirmed','boolean','Final doctor approval status'],
    ['confirmed_by / confirmed_at','uuid / timestamp','Approval audit trail'],
  ],[145,145,223]);
  heading('4. Matching and safety rules');
  bullet('High confidence: exact generic/brand match plus compatible strength or form. Normalize automatically, but retain the spoken phrase.');
  bullet('Medium confidence: fuzzy speech match such as "Tolo 650" -> possible "Dolo 650". Show a confirmation prompt; do not silently replace it.');
  bullet('Low confidence: no reliable match or conflicting strengths. Keep the spoken text in Doctor Notes and require manual editing.');
  bullet('A temperature, BP, pulse, glucose reading, age, or weight must never become a medicine row just because it contains a number or unit.');
  callout('Clinical safety:', 'The system assists documentation. It must not independently prescribe, change a dose, or confirm an ambiguous medicine.');
  newPage();
  heading('5. Example: Dolo / Paracetamol');
  table(['Doctor speech','Dictionary result','Final action'],[
    ['Give Dolo 650','Paracetamol + Dolo + 650 mg','Create one verified row'],
    ['Tolo six-fifty','Possible Dolo 650 mg','Ask doctor to confirm'],
    ['PCM BD for 3 days after food','Paracetamol 650 mg | twice daily | 3 days | after food','Normalize abbreviations and retain all fields'],
    ['Temperature 102 Fahrenheit','Temperature: 102°F','Store in examination/notes, never medication'],
  ],[175,185,193]);
  heading('6. What the AI parser returns');
  para('The parser response should contain two objects: a medicines array and a clinical_summary object. The summary must capture every clinically relevant fact even when it appears in the same sentence as a medicine or booking instruction.');
  table(['Output','Required fields'],[
    ['medicines[]','medicine_name, dosage, frequency, duration, instructions'],
    ['clinical_summary','concern, chief_complaints[], history_summary[], examination[], diagnosis, general_advice[], precautions[], follow_up[], red_flags[]'],
    ['audit metadata','spoken_text, confidence_score, match_type, doctor_confirmed'],
  ],[160,393]);
  heading('7. UI behavior during parsing');
  bullet('Immediately after speech: show the local clinical draft.');
  bullet('During the 900 ms debounce or API request: show “Analyzing prescription...” so the doctor knows the draft is being checked.');
  bullet('If AI succeeds: replace only the structured sections, preserve all unmatched clinical text in Doctor Notes, and remove duplicates.');
  bullet('If AI fails: keep the local draft and allow manual editing; do not clear the draft.');
  bullet('After Stop or Send: cancel timers and invalidate in-flight responses. A late response must not overwrite the doctor-approved text.');
  heading('8. PDF content');
  table(['PDF section','Content'],[
    ['Chief complaints','Doctor-reported symptoms and main concern'],
    ['History / examination','Duration, readings, findings, relevant history'],
    ['Diagnosis','Only what the doctor dictated or approved; never invented'],
    ['Medications','One row per approved medicine with name, strength, dose, frequency, duration, instructions'],
    ['Advice / precautions / follow-up','Doctor-dictated instructions, deduplicated'],
    ['Doctor verbatim notes','Original dictated wording retained as an audit backup'],
  ],[170,383]);
  heading('9. Starter catalog and expansion');
  para('Do not claim that every medicine is covered from day one. Start with a doctor-reviewed catalog of common Indian medicines and expand through verified additions. Each new alias should be linked to an existing generic/brand record and reviewed before it becomes an automatic match.');
  bullet('Initial seed: common fever, pain, allergy, antibiotic, gastric, respiratory, diabetes, BP, dermatology, and pregnancy-related medicines.');
  bullet('Source policy: use a licensed medicine catalog or pharmacist/doctor-maintained source. Do not scrape a commercial website without permission.');
  bullet('Correction loop: when a doctor confirms a fuzzy match, store the alias and correction event for review; do not automatically promote every correction to verified status.');
  heading('10. Acceptance checklist');
  ['A spoken medicine appears once in the draft and once in the PDF.','Name, strength, dose, frequency, duration, and timing stay together.','Clinical readings never become medicine rows.','Ambiguous names require doctor confirmation.','AI loading is visible and late responses cannot overwrite reviewed text.','Original doctor wording remains available for audit.','The dictionary can expand without a mobile app release.'].forEach(x => bullet(x));
  callout('Final recommendation:', 'Implement the dictionary as a Supabase-backed, doctor-reviewed catalog with confidence scoring. This is safer and more maintainable than putting a huge unverified medicine list in the app.',C.goldFill,C.gold);
  const pages=pdf.getPages(); pages.forEach((p,i)=>{p.drawText(`CD4 | Doctor review only | Page ${i+1} of ${pages.length}`,{x:M,y:25,size:8,font:regular,color:C.muted});});
  const bytes=await pdf.save(); fs.writeFileSync(OUT,bytes); console.log(OUT, bytes.length);
})();
