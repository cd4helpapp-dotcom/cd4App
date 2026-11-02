// Loads supabase/knowledge/**/*.md into the CD4 AI knowledge base.
//   node scripts/ingest-knowledge.mjs --dry-run     show the chunks, nothing is sent anywhere
//   node scripts/ingest-knowledge.mjs               needs the Supabase CLI login and the embed-knowledge function deployed
//
// Unchanged chunks are skipped, so only edited text pays for new embeddings.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chunkMarkdown, parseFrontmatter } from './knowledge-chunker.mjs';
import { embedTexts, requireService, SERVICE_KEY, SUPABASE_URL } from './knowledge-env.mjs';

const ROOT = new URL('../supabase/knowledge/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dryRun = process.argv.includes('--dry-run');

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.md') && entry.name !== 'README.md' ? [full] : [];
  });

const loadFile = (file) => {
  const source = path.relative(ROOT, file).replace(/\\/g, '/');
  const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const category = meta.category;
  if (!['app_help', 'medical'].includes(category)) throw new Error(`${source}: category must be app_help or medical`);
  // Medical text reaches patients as fact, so every file must say where it came from.
  if (category === 'medical' && (!meta.reference || !meta.source_date)) {
    throw new Error(`${source}: medical content needs reference and source_date`);
  }
  if (meta.reviewed_by && !meta.reviewed_on) throw new Error(`${source}: reviewed_by needs reviewed_on`);
  // reviewed_on stays empty until a clinician signs off, so `where reviewed_on is null` lists what is still waiting.
  const sourceLine = category === 'medical' ? meta.reference.split(',')[0].replace(/ fact sheet$/, '') : '';
  return chunkMarkdown(body, meta.title || source, { sourceLine }).map((chunk, index) => ({
    source,
    title: chunk.title,
    chunk_index: index,
    content: chunk.content,
    content_hash: crypto.createHash('sha256').update(chunk.content).digest('hex'),
    category,
    audience: meta.audience || 'all',
    reviewed_on: meta.reviewed_on || null,
  }));
};

export const loadKnowledgeChunks = () => walk(ROOT).flatMap(loadFile);

// Run as a command, not when knowledge-status.mjs imports loadKnowledgeChunks.
const isMain = path.resolve(process.argv[1] || '') === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) await main();

async function main() {
const chunks = loadKnowledgeChunks();
console.log(`${chunks.length} chunks from ${new Set(chunks.map((c) => c.source)).size} files`);

if (dryRun) {
  for (const chunk of chunks) console.log(`\n[${chunk.source} #${chunk.chunk_index}] ${chunk.content.length} chars\n${chunk.content}`);
  return;
}

requireService();
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const { data: existing, error: readError } = await admin.from('ai_knowledge_chunks').select('id, source, chunk_index, content_hash');
if (readError) throw readError;
const key = (row) => `${row.source}#${row.chunk_index}`;
const existingByKey = new Map(existing.map((row) => [key(row), row]));
const wanted = new Set(chunks.map(key));

const stale = existing.filter((row) => !wanted.has(key(row)));
if (stale.length) {
  const { error } = await admin.from('ai_knowledge_chunks').delete().in('id', stale.map((row) => row.id));
  if (error) throw error;
}

const changed = chunks.filter((chunk) => existingByKey.get(key(chunk))?.content_hash !== chunk.content_hash);
const vectors = await embedTexts(changed.map((chunk) => chunk.content));
for (let i = 0; i < changed.length; i += 50) {
  const rows = changed.slice(i, i + 50).map((chunk, index) => ({ ...chunk, embedding: JSON.stringify(vectors[i + index]) }));
  const { error } = await admin.from('ai_knowledge_chunks').upsert(rows, { onConflict: 'source,chunk_index' });
  if (error) throw error;
}
console.log(`Embedded ${changed.length}, removed ${stale.length}, unchanged ${chunks.length - changed.length}`);
}
