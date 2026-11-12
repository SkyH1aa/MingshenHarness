// resources/tencentdb-memory/upstream/adapters/tokenize.js
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
function extractQueryTokens(raw) {
	const tokens = [];
	for (const { segment, isWordLike } of segmenter.segment(raw.slice(0, 16e3))) {
		if (!isWordLike) continue;
		tokens.push(segment.toLowerCase());
		if (/^[\p{Script=Han}]+$/u.test(segment)) {
			const chars = [...segment];
			for (let i = 0; i + 1 < chars.length; i++) tokens.push(chars[i] + chars[i + 1]);
		}
	}
	return [...new Set(tokens)];
}
function buildFtsQuery(raw) {
	const tokens = extractQueryTokens(raw).slice(0, 80);
	return tokens.length ? tokens.map((t) => `"${t.replaceAll("\"", "")}"`).join(" OR ") : null;
}
function tokenizeForFts(raw) {
	return extractQueryTokens(raw).join(" ");
}
function bm25RankToScore(rank) {
	return Number.isFinite(rank) ? rank < 0 ? -rank / (1 - rank) : 1 / (1 + rank) : .001;
}
function _resetJiebaForTest() {}
function _setJiebaForTest() {}
export { tokenizeForFts as a, buildFtsQuery as i, _setJiebaForTest as n, bm25RankToScore as r, _resetJiebaForTest as t };
