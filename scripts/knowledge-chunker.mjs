// Splits a knowledge file into small chunks for retrieval. Shared by the ingest script and its tests.
//
// Small chunks keep one fact per chunk, so a search returns the answer instead of a page around it. Each chunk starts
// with its file and section title, because "You can cancel up to 2 hours before" means little without knowing the topic.

export const CHUNK_TARGET_CHARS = 800; // about 200 tokens
export const CHUNK_OVERLAP_CHARS = 100;

export const parseFrontmatter = (raw) => {
  const text = raw.replace(/\r\n/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: {}, body: text };
  const meta = Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => line.split(/:\s*/, 2))
      .filter((pair) => pair.length === 2)
      .map(([key, value]) => [key.trim(), value.trim()])
  );
  return { meta, body: text.slice(match[0].length) };
};

const splitLongText = (text, target, overlap) => {
  if (text.length <= target) return [text];
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + target, text.length);
    if (end < text.length) {
      // End on a sentence, or at least a word, so no chunk stops mid-thought.
      const window = text.slice(start, end);
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'), window.lastIndexOf('? '));
      const space = window.lastIndexOf(' ');
      if (sentence > target * 0.5) end = start + sentence + 1;
      else if (space > target * 0.5) end = start + space;
    }
    parts.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return parts.filter(Boolean);
};

export const chunkMarkdown = (body, title, { target = CHUNK_TARGET_CHARS, overlap = CHUNK_OVERLAP_CHARS, sourceLine = '' } = {}) => {
  const sections = [];
  let current = { heading: '', lines: [] };
  for (const line of body.split('\n')) {
    const heading = line.match(/^#{1,3}\s+(.*)$/);
    if (heading) {
      if (current.lines.join('').trim()) sections.push(current);
      current = { heading: heading[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('').trim()) sections.push(current);

  const chunks = [];
  for (const section of sections) {
    const text = section.lines.join('\n').trim();
    for (const part of splitLongText(text, target, overlap)) {
      const label = [title, section.heading].filter(Boolean).join(' > ');
      chunks.push({ title: section.heading || title, content: `${label}\n${part}${sourceLine ? `\nSource: ${sourceLine}` : ''}` });
    }
  }
  return chunks;
};
