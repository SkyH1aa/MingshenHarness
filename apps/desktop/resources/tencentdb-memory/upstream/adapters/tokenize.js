const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
export function extractQueryTokens(raw) {
  const tokens = [];
  for (const { segment, isWordLike } of segmenter.segment(raw.slice(0, 16000))) {
    if (!isWordLike) continue;
    tokens.push(segment.toLowerCase());
    if (/^[\p{Script=Han}]+$/u.test(segment)) {
      const chars = [...segment];
      for (let i = 0; i + 1 < chars.length; i++) tokens.push(chars[i] + chars[i + 1]);
    }
  }
  return [...new Set(tokens)];
}
export function buildFtsQuery(raw) {
  const tokens = extractQueryTokens(raw).slice(0, 80);
  return tokens.length ? tokens.map(t => `"${t.replaceAll('"', '')}"`).join(' OR ') : null;
}
export function tokenizeForFts(raw) { return extractQueryTokens(raw).join(' '); }
export function bm25RankToScore(rank) {
  return Number.isFinite(rank) ? (rank < 0 ? -rank / (1 - rank) : 1 / (1 + rank)) : 0.001;
}
export function mongoSearchScoreToScore(score) { return score > 0 ? score / (1 + score) : 0; }
export function _resetJiebaForTest() {}
export function _setJiebaForTest() {}
