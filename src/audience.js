const SCRIPTS = [
  ['Devanagari', 'Devanagari script', 'Hindi, Marathi or Nepali. Suggests India or Nepal'],
  ['Arabic', 'Arabic script', 'Arabic or Urdu. Suggests the Middle East, North Africa or Pakistan'],
  ['Bengali', 'Bengali script', 'Suggests Bangladesh or eastern India'],
  ['Tamil', 'Tamil script', 'Suggests south India or Sri Lanka'],
  ['Telugu', 'Telugu script', 'Suggests south India'],
  ['Gujarati', 'Gujarati script', 'Suggests western India'],
  ['Gurmukhi', 'Gurmukhi script', 'Punjabi. Suggests northern India'],
  ['Kannada', 'Kannada script', 'Suggests south India'],
  ['Malayalam', 'Malayalam script', 'Suggests south India'],
  ['Cyrillic', 'Cyrillic script', 'Russian, Ukrainian and others. Suggests Eastern Europe or Central Asia'],
  ['Hangul', 'Korean script', 'Suggests Korea'],
  ['Hiragana', 'Japanese script', 'Suggests Japan'],
  ['Katakana', 'Japanese script', 'Suggests Japan'],
  ['Han', 'Chinese characters', 'Suggests China, Taiwan, Hong Kong or Japan'],
  ['Thai', 'Thai script', 'Suggests Thailand'],
  ['Hebrew', 'Hebrew script', 'Suggests Israel'],
  ['Latin', 'Latin script', 'English, romanised Hindi, Spanish and many more, so it does not point to a country'],
].map(([script, label, hint]) => ({ regex: new RegExp(`\\p{Script=${script}}`, 'gu'), label, hint }));

const LETTER = /\p{L}/u;

const PLACE_TAGS = {
  india: 'India', mumbai: 'India', delhi: 'India', bangalore: 'India', bengaluru: 'India', pune: 'India', hyderabad: 'India', chennai: 'India', kolkata: 'India',
  dubai: 'UAE', uae: 'UAE', abudhabi: 'UAE', saudi: 'Saudi Arabia', riyadh: 'Saudi Arabia', qatar: 'Qatar',
  usa: 'United States', nyc: 'United States', newyork: 'United States', losangeles: 'United States',
  uk: 'United Kingdom', london: 'United Kingdom', canada: 'Canada', toronto: 'Canada', australia: 'Australia', sydney: 'Australia', melbourne: 'Australia',
  singapore: 'Singapore', pakistan: 'Pakistan', karachi: 'Pakistan', lahore: 'Pakistan', bangladesh: 'Bangladesh', dhaka: 'Bangladesh', nepal: 'Nepal',
  germany: 'Germany', berlin: 'Germany', france: 'France', paris: 'France', spain: 'Spain', italy: 'Italy', brazil: 'Brazil', mexico: 'Mexico', indonesia: 'Indonesia',
};

export function dominantScript(text) {
  let best = null;
  let bestCount = 0;
  for (const script of SCRIPTS) {
    const count = text.match(script.regex)?.length ?? 0;
    if (count > bestCount) {
      best = script;
      bestCount = count;
    }
  }
  return best;
}

function tally(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

const BUYING = /(\bprice\b|\bcost\b|how much|\bkitna\b|\bkitne\b|\bbuy\b|\border\b|where (can|do|to).*(get|find|buy)|available|\bdeliver|\bshipping\b|\bship to\b|\bbook\b|\blink\b|\bdm\b|\bwebsite\b|\bstore\b|कितन|कीमत)/iu;

const KEYWORD_REPEATS = 5;
const EVERYDAY_WORDS = new Set(['nice', 'wow', 'great', 'good', 'love', 'amazing', 'awesome', 'super', 'beautiful', 'lovely', 'thanks', 'thankyou', 'cool', 'perfect', 'wonderful', 'yes', 'no', 'true', 'best', 'osm', 'mam', 'maam', 'sir', 'done', 'gorgeous', 'inspiring', 'helpful']);

/** One word repeated by many people is usually a reply to "comment X to get Y", which is not the same as wanting to buy. */
// One-word price requests ("price", "pp" for "price please") are buyers asking, never a prompt reply.
const PRICE_WORDS = new Set(['price', 'prices', 'pp', 'pricepls', 'priceplease', 'pricepl', 'rate', 'rates', 'cost', 'kitna', 'kitne', 'kitnekahai', 'kitnekaa', 'कितना', 'कितने', 'कीमत']);

function keywordReplySet(comments) {
  const counts = new Map();
  for (const text of comments) {
    const word = text.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (word && !/\s/.test(text.trim()) && !EVERYDAY_WORDS.has(word) && !PRICE_WORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count >= KEYWORD_REPEATS).map(([word]) => word));
}

export function classifyComments(comments) {
  const keywords = keywordReplySet(comments);
  const isKeywordReply = (text) => keywords.has(text.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
  return {
    sampled: comments.length,
    questions: comments.filter((text) => text.includes('?')).length,
    buyingIntent: comments.filter((text) => !isKeywordReply(text) && (BUYING.test(text) || PRICE_WORDS.has(text.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')))).length,
    emojiOnly: comments.filter((text) => !LETTER.test(text)).length,
    keywordReplies: comments.filter(isKeywordReply).length,
    replyKeywords: [...keywords].slice(0, 5),
  };
}

function scriptShares(texts) {
  const hints = new Map(SCRIPTS.map((s) => [s.label, s.hint]));
  const withLetters = texts.filter((text) => LETTER.test(text));
  return tally(withLetters, (text) => dominantScript(text)?.label).map(({ label, count }) => ({
    label,
    count,
    share: count / withLetters.length,
    hint: hints.get(label),
  }));
}

/**
 * Builds audience clues from public text. Likes and views aren't broken down by country anywhere
 * public, so this reports clues rather than any percentage of views by country.
 */
export function buildAudience(profile, posts, extraComments = []) {
  const comments = [...posts.flatMap((post) => post.commentSample ?? []), ...extraComments];
  const places = posts.flatMap((post) => post.hashtags.map((tag) => PLACE_TAGS[tag.toLowerCase()]).filter(Boolean));
  return {
    accountCountry: profile.country,
    commentScripts: scriptShares(comments),
    captionScripts: scriptShares(posts.map((post) => post.caption)),
    locationTags: tally(posts, (post) => post.location).slice(0, 8),
    placeHashtags: tally(places, (place) => place).slice(0, 8),
    intent: classifyComments(comments),
  };
}

/** Clues for one post, so the report can say where an individual video may have landed. */
export function postAudienceHint(post) {
  const comments = post.commentSample ?? [];
  const scripts = scriptShares(comments);
  const top = scripts[0];
  return {
    location: post.location,
    commentsSampled: comments.length,
    topCommentScript: top && comments.length >= 5 ? { label: top.label, share: top.share, hint: top.hint } : null,
  };
}
