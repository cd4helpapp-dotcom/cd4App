// Measures the two similarity thresholds on labelled examples, using the real embedding model and knowledge files.
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/tune-agent-thresholds.mjs
// Costs far less than one rupee. Apply the result with `supabase secrets set AI_CACHE_SIMILARITY=... AI_MIN_KNOWLEDGE_SCORE=...`.
import fs from 'node:fs';
import path from 'node:path';
import { chunkMarkdown, parseFrontmatter } from './knowledge-chunker.mjs';
import { embedTexts, requireService } from './knowledge-env.mjs';

requireService();
const embed = embedTexts;
const cosine = (a, b) => {
  let dot = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return dot / Math.sqrt(x * y);
};

// Cache: pairs that may share an answer, and pairs that must never share one.
const SAME = [
  ['what are the symptoms of dengue', 'what are common dengue symptoms'],
  ['symptoms of malaria', 'what are the symptoms of malaria'],
  ['how is typhoid treated', 'what is the treatment for typhoid'],
  ['what causes anaemia', 'what are the causes of anaemia'],
  ['how to prevent diabetes', 'how can diabetes be prevented'],
  ['डेंगू के लक्षण क्या हैं', 'डेंगू के क्या लक्षण होते हैं'],
  ['dengue ke lakshan kya hain', 'dengue ke kya lakshan hote hain'],
];
const DIFFERENT = [
  ['what are the symptoms of dengue', 'what are the symptoms of malaria'],
  ['symptoms of type 1 diabetes', 'symptoms of type 2 diabetes'],
  ['how to treat high blood pressure', 'how to treat low blood pressure'],
  ['is paracetamol safe in pregnancy', 'is ibuprofen safe in pregnancy'],
  ['what is the normal blood sugar', 'what is the normal blood pressure'],
  ['treatment of dengue', 'prevention of dengue'],
  ['symptoms of heart attack', 'symptoms of stroke'],
  ['asthma in children', 'asthma in adults'],
  ['डेंगू के लक्षण क्या हैं', 'मलेरिया के लक्षण क्या हैं'],
  ['dengue ke lakshan kya hain', 'malaria ke lakshan kya hain'],
];

// Retrieval: questions with the file that answers them, and off-topic questions that should find nothing.
const ANSWERABLE = [
  ['how do I cancel my appointment', 'booking-and-payments'],
  ['how long will my refund take', 'booking-and-payments'],
  ['can I change my appointment time', 'booking-and-payments'],
  ['paise kat gaye par booking nahi hui', 'booking-and-payments'],
  ['how many reports can I upload for free', 'reports-and-ai'],
  ['who can see my reports', 'reports-and-ai'],
  ['how do I delete my account', 'reports-and-ai'],
  ['what are the warning signs of dengue', 'dengue'],
  ['can I take ibuprofen in dengue', 'dengue'],
  ['dengue me kaunsi dawai nahi leni chahiye', 'dengue'],
  ['malaria symptoms', 'malaria'],
  ['how is TB spread', 'tuberculosis'],
  ['why should I finish my TB medicine', 'tuberculosis'],
  ['what is a normal blood pressure limit', 'hypertension'],
  ['bp kaise kam kare', 'hypertension'],
  ['sugar ke lakshan kya hain', 'diabetes'],
  ['my child has loose motions what should I give', 'diarrhoea'],
  ['signs of dehydration', 'diarrhoea'],
  ['seene mein dard aur pasina aa raha hai', 'heart_attack_stroke'],
  ['sudden weakness on one side of the face', 'heart_attack_stroke'],
  ['I feel sad all the time and have no interest', 'depression'],
  ['khoon ki kami ke lakshan', 'anaemia'],
  ['saans phoolna aur wheezing', 'asthma'],
  ['typhoid mein kya khana chahiye aur paani', 'typhoid'],
  ['flu symptoms', 'influenza'],
];
const OFF_TOPIC = ['who won the cricket world cup', 'write a poem about rain', 'best phone under 20000', 'capital of france', 'how to cook biryani', 'bitcoin price today', 'knee replacement surgery cost', 'what is the side effect of metformin'];

const root = new URL('../supabase/knowledge/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.md') && e.name !== 'README.md' ? [path.join(dir, e.name)] : []));
const chunks = walk(root).flatMap((file) => {
  const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  return chunkMarkdown(body, meta.title).map((chunk) => ({ file: path.basename(file, '.md'), content: chunk.content }));
});
const chunkVectors = await embed(chunks.map((c) => c.content));

const flatPairs = [...SAME, ...DIFFERENT].flat();
const pairVectors = await embed(flatPairs);
const pairScore = (index) => cosine(pairVectors[index * 2], pairVectors[index * 2 + 1]);
const sameScores = SAME.map((pair, i) => ({ pair, score: pairScore(i) }));
const differentScores = DIFFERENT.map((pair, i) => ({ pair, score: pairScore(SAME.length + i) }));

console.log('\nCACHE: same question, different words');
sameScores.forEach(({ pair, score }) => console.log(`  ${score.toFixed(3)}  ${pair.join('  |  ')}`));
console.log('CACHE: different questions (must never match)');
differentScores.sort((a, b) => b.score - a.score).forEach(({ pair, score }) => console.log(`  ${score.toFixed(3)}  ${pair.join('  |  ')}`));
const highestDifferent = Math.max(...differentScores.map((row) => row.score));
const cacheThreshold = Math.min(0.99, Math.max(0.9, Number((highestDifferent + 0.02).toFixed(2))));
console.log(`\nHighest "different" pair ${highestDifferent.toFixed(3)}. Safety matters more than hit rate, so 0.02 above it: ${cacheThreshold}`);
console.log(`Same-question pairs it would catch: ${sameScores.filter((row) => row.score >= cacheThreshold).length}/${sameScores.length}`);

const queryVectors = await embed([...ANSWERABLE.map(([q]) => q), ...OFF_TOPIC]);
const best = (vector) => chunks.map((chunk, i) => ({ file: chunk.file, score: cosine(vector, chunkVectors[i]) })).sort((a, b) => b.score - a.score);
const answerable = ANSWERABLE.map(([q, file], i) => {
  const ranked = best(queryVectors[i]);
  return { q, file, score: ranked[0].score, top1: ranked[0].file === file, top4: ranked.slice(0, 4).some((row) => row.file === file) };
});
const offTopic = OFF_TOPIC.map((q, i) => ({ q, score: best(queryVectors[ANSWERABLE.length + i])[0].score }));

console.log('\nRETRIEVAL: questions the knowledge base can answer');
answerable.forEach((row) => console.log(`  ${row.score.toFixed(3)} ${row.top4 ? 'found ' : 'MISSED'} ${row.q}`));
console.log('RETRIEVAL: off-topic questions');
offTopic.forEach((row) => console.log(`  ${row.score.toFixed(3)} ${row.q}`));
console.log(`\nRecall: right file first ${answerable.filter((r) => r.top1).length}/${answerable.length}, in top 4 ${answerable.filter((r) => r.top4).length}/${answerable.length}`);

const candidates = Array.from({ length: 41 }, (_, i) => Number((0.15 + i * 0.01).toFixed(2)));
const scoreFor = (threshold) => {
  const kept = answerable.filter((r) => r.top4 && r.score >= threshold).length;
  const blocked = offTopic.filter((r) => r.score < threshold).length;
  return kept / answerable.length + blocked / offTopic.length;
};
const bestThreshold = candidates.reduce((top, t) => (scoreFor(t) > scoreFor(top) ? t : top), candidates[0]);
console.log(`Best knowledge threshold: ${bestThreshold} (keeps ${answerable.filter((r) => r.top4 && r.score >= bestThreshold).length}/${answerable.length} answerable, blocks ${offTopic.filter((r) => r.score < bestThreshold).length}/${offTopic.length} off-topic)`);
console.log(`\nnpx supabase secrets set AI_CACHE_SIMILARITY=${cacheThreshold} AI_MIN_KNOWLEDGE_SCORE=${bestThreshold}`);
