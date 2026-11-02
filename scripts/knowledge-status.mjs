// Shows whether the knowledge files match what CD4 AI is using, and tests what a question would find.
//   npm run knowledge:status
//   npm run knowledge:search -- "dengue me kaunsi dawai nahi leni"
import { createClient } from '@supabase/supabase-js';
import { embedTexts, requireService, SERVICE_KEY, SUPABASE_URL } from './knowledge-env.mjs';
import { loadKnowledgeChunks } from './ingest-knowledge.mjs';

requireService();
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const question = process.argv.slice(2).join(' ').trim();

if (question) {
  const [embedding] = await embedTexts([question]);
  const { data, error } = await admin.rpc('match_ai_knowledge', {
    p_query_text: question,
    p_query_embedding: JSON.stringify(embedding),
    p_audience: 'patient',
    p_category: null,
    p_match_count: 4,
  });
  if (error) throw error;
  const threshold = Number(process.env.AI_MIN_KNOWLEDGE_SCORE) || 0.32;
  console.log(`\n"${question}"\n`);
  if (!data.length) console.log('Nothing found. Add this topic to the knowledge files.');
  for (const row of data) {
    const used = row.score >= threshold || row.keyword_hit;
    console.log(`${row.score.toFixed(3)} ${row.keyword_hit ? 'keyword' : '       '} ${used ? 'USED   ' : 'ignored'} ${row.source}: ${row.title}`);
  }
  process.exit(0);
}

const { data: rows, error } = await admin.from('ai_knowledge_chunks').select('source, chunk_index, content_hash, category, reviewed_on');
if (error) throw error;
const local = loadKnowledgeChunks();
const key = (row) => `${row.source}#${row.chunk_index}`;
const live = new Map(rows.map((row) => [key(row), row]));
const wanted = new Set(local.map(key));

const fresh = local.filter((chunk) => !live.has(key(chunk)));
const changed = local.filter((chunk) => live.has(key(chunk)) && live.get(key(chunk)).content_hash !== chunk.content_hash);
const removed = rows.filter((row) => !wanted.has(key(row)));

console.log(`\nLive: ${rows.length} chunks  |  Files: ${local.length} chunks\n`);
const bySource = new Map();
for (const row of rows) bySource.set(row.source, (bySource.get(row.source) || 0) + 1);
for (const [source, count] of [...bySource].sort()) console.log(`  ${String(count).padStart(3)}  ${source}`);

const waiting = new Set(rows.filter((row) => row.category === 'medical' && !row.reviewed_on).map((row) => row.source));
console.log(`\nMedical files waiting for a doctor's review: ${waiting.size}`);
for (const source of [...waiting].sort()) console.log(`  ${source}`);

if (fresh.length || changed.length || removed.length) {
  console.log(`\nNot live yet: ${fresh.length} new, ${changed.length} changed, ${removed.length} to remove. Run: npm run ingest:knowledge`);
} else {
  console.log('\nEverything in the files is live.');
}
