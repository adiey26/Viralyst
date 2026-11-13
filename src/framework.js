// The Viralyst Instagram Audit Framework: 13 weighted pillars and 95 checkpoints.
//
// source says where a checkpoint's first answer comes from:
//   auto   = calculated by the tool from public data
//   ai     = judged by Claude from public covers, video frames, captions, comments and link pages
//   manual = private or off-platform, so the auditor enters it from Insights or the client
// partial explains what public data can't see, for checkpoints it only partly covers.
//
// The bands and rating scores below are starting assumptions, not published benchmarks.
// Adjust them here to match Viralyst's own view of what good looks like.

export const RATINGS = {
  strong: { label: 'Strong', score: 90 },
  healthy: { label: 'Healthy', score: 75 },
  needs_work: { label: 'Needs work', score: 50 },
  critical: { label: 'Critical', score: 20 },
};

/** Higher is better: the first band whose minimum the value reaches gives the score. */
const percentInput = (label, bands) => ({ kind: 'number', unit: '%', label, bands });
/** Lower is better: the first band whose maximum the value stays within gives the score. */
const lowerInput = (label, bands) => ({ kind: 'number', unit: '%', label, bands, lowerIsBetter: true });

function check(id, title, lookAt, why, source, extra = {}) {
  return { id, title, lookAt, why, source, ...extra };
}

export const PILLARS = [
  {
    id: 1, title: 'Profile and first impression', weight: 8,
    checks: [
      check('1.1', 'Handle and name field', 'Is the handle easy to spell? Does the name field include a searchable keyword?', 'The name field is indexed by Instagram search.', 'ai'),
      check('1.2', 'Profile photo', 'Legible at small size and inside the circular crop, and consistent with other channels.', 'It appears on every comment, Story and DM.', 'ai', { partial: 'Other channels are not compared.' }),
      check('1.3', 'Bio', 'Who you help, what you offer, proof, and a clear next step within the first two lines.', 'A clear bio turns profile visits into follows and clicks.', 'ai'),
      check('1.4', 'Category, contact and action buttons', 'Business category, email, call, WhatsApp, directions, Book or Shop buttons.', 'Missing buttons are lost leads.', 'manual', { hint: 'Open the profile on a phone and check which buttons appear.' }),
      check('1.5', 'Link in bio', 'Where the link goes, clicks to purchase, mobile load speed, tracking tags.', 'A slow or confusing link page leaks traffic.', 'auto', { partial: 'Measures redirects, server response and tags. Clicks to purchase and true mobile speed need a manual check.' }),
      check('1.6', 'Highlights', 'Number, order, cover design, and whether they answer buyer questions.', 'Highlights act as a mini-website.', 'manual', { hint: 'Open the profile and check the number, order, covers and topics by eye.' }),
      check('1.7', 'Pinned posts', 'Whether pinned posts introduce the brand, show proof and drive the main offer.', 'They are the first content most visitors see.', 'ai'),
      check('1.8', 'Grid consistency', 'Visual identity, colours, fonts and cover templates across the last 12–30 posts.', 'A consistent grid signals a trustworthy brand.', 'ai'),
      check('1.9', 'Trust signals', 'Verification, press, awards, testimonials, follower milestones and partner tags.', 'Trust signals reduce the risk a buyer feels.', 'ai', { partial: 'Highlights and website proof may not be visible.' }),
    ],
  },
  {
    id: 2, title: 'Audience health', weight: 8,
    checks: [
      check('2.1', 'Follower growth trend', 'Net follows, unfollows and growth rate over 30, 90 and 365 days.', 'Shows momentum and past campaign impact.', 'auto', { partial: 'Calculated from daily tracking once 7 days exist. Unfollows and past periods need Insights.', input: percentInput('Follower growth over 90 days', [[15, 90], [7, 75], [2, 55], [0, 35], [-Infinity, 15]]) }),
      check('2.2', 'Audience match', 'Top countries, cities, age and gender against the target customer.', 'Reaching people who cannot buy wastes effort.', 'manual', { hint: 'From Insights audience data. The report\'s location clues are indirect only.' }),
      check('2.3', 'Follower quality', 'Signs of bots, giveaway-only followers, and spikes that do not match content.', 'Low-quality followers suppress reach.', 'auto', { partial: 'A rough estimate from engagement, comments and follower jumps. No follower list is inspected.' }),
      check('2.4', 'Active audience share', 'Accounts engaged compared with total followers.', 'Shows how much of the audience still pays attention.', 'manual', { input: percentInput('Accounts engaged ÷ followers, 30 days', [[20, 90], [10, 75], [5, 50], [2, 30], [-Infinity, 15]]) }),
      check('2.5', 'Follower vs non-follower reach', 'Share of views from people who do not follow yet.', 'Non-follower reach is how accounts grow.', 'manual', { input: percentInput('Views from non-followers', [[60, 90], [40, 75], [25, 50], [10, 30], [-Infinity, 15]]) }),
      check('2.6', 'Most active times', 'The days and hours followers are online.', 'Used to plan posting times, then tested.', 'manual', { hint: 'From Insights. The report shows public performance by day and time for comparison.' }),
      check('2.7', 'Follow-to-following ratio', 'Whether the account follows many more accounts than follow it.', 'An unusual ratio can look spammy.', 'auto'),
    ],
  },
  {
    id: 3, title: 'Content strategy', weight: 10,
    checks: [
      check('3.1', 'Content pillars', 'The 3–5 recurring themes and how much of the feed each takes.', 'Clear pillars make you memorable.', 'ai'),
      check('3.2', 'Goal mix', 'Share of posts built to reach new people, build trust, and sell.', 'Too much selling stalls growth; no selling stalls revenue.', 'ai'),
      check('3.3', 'Format mix', 'Reels, carousels, single images, Stories, Lives and collaborations.', 'Each format does a different job.', 'auto', { partial: 'Stories and Lives are not visible in public feed data.' }),
      check('3.4', 'Posting consistency', 'Posts per week, gaps longer than 7 days, and stability over time.', 'Consistency builds habit.', 'auto'),
      check('3.5', 'Series and repeatable formats', 'Recurring series people can recognise and anticipate.', 'Series are efficient and build loyalty.', 'ai'),
      check('3.6', 'Evergreen vs trend', 'Share of content still useful months later versus trend-only posts.', 'Evergreen posts keep getting views.', 'ai'),
      check('3.7', 'Originality', 'Original content compared with reposts, watermarked or recycled clips.', 'Instagram favours original content.', 'ai', { partial: 'Judged from sampled frames and captions, so recycled clips can be missed.' }),
      check('3.8', 'Brand voice', 'Tone, language and messaging consistency across captions and videos.', 'A recognisable voice builds trust.', 'ai'),
    ],
  },
  {
    id: 4, title: 'Reels performance', weight: 14,
    checks: [
      check('4.1', 'Views and reach', 'Views, accounts reached, and how both trend.', 'The baseline for every other ratio.', 'auto', { partial: 'Views are public. Accounts reached needs Insights.' }),
      check('4.2', 'Skip rate', 'Share of viewers who swipe away within 3 seconds.', 'The most direct measure of hook strength.', 'manual', { input: lowerInput('Typical skip rate', [[30, 90], [45, 70], [60, 50], [Infinity, 25]]) }),
      check('4.3', 'Retention curve', 'Where viewers drop off, second by second.', 'Shows which moment to fix.', 'manual', { hint: 'Review the retention graph in Insights for your best and worst Reels.' }),
      check('4.4', 'Average watch time', 'Average seconds watched compared with Reel length.', 'A key signal for recommendations.', 'manual', { input: percentInput('Average watch time ÷ Reel length', [[70, 90], [50, 75], [35, 50], [20, 30], [-Infinity, 15]]) }),
      check('4.5', 'Share rate', 'Shares and sends per view.', 'Sends are a strong signal for reaching new people.', 'manual', { input: percentInput('Shares per view', [[1, 90], [0.5, 75], [0.2, 50], [0.05, 30], [-Infinity, 15]]) }),
      check('4.6', 'Save rate', 'Saves per view.', 'Saves show useful content.', 'manual', { input: percentInput('Saves per view', [[1, 90], [0.5, 75], [0.2, 50], [0.05, 30], [-Infinity, 15]]) }),
      check('4.7', 'Comment and like rate', 'Comments and likes per view.', 'Shows emotional response.', 'auto'),
      check('4.8', 'Follows per Reel', 'New followers gained from each Reel.', 'Separates entertaining from growing.', 'manual', { hint: 'From Insights per Reel. The Follower growth section shows public timing clues only.' }),
      check('4.9', 'Views over time', 'Whether a Reel keeps getting views after 48 hours.', 'Long-tail Reels show topics worth repeating.', 'manual', { hint: 'From Insights per Reel.' }),
      check('4.10', 'Outlier analysis', 'Reels far above or below the median, and what they share.', 'Your outliers guide what to make next.', 'auto'),
    ],
  },
  {
    id: 5, title: 'Hooks and creative quality', weight: 10,
    checks: [
      check('5.1', 'First frame', 'What appears before the viewer decides to scroll.', 'If it does not stop the thumb, nothing else matters.', 'ai'),
      check('5.2', 'Hook type and first line', 'The opening line and on-screen text, classified.', 'Shows which hook styles work.', 'ai'),
      check('5.3', 'Structure and pacing', 'Hook, problem, proof, solution, call to action, timing and cuts per 10 seconds.', 'Good pacing keeps viewers to the end.', 'ai', { partial: 'Cuts are measured on sampled Reels. Structure comes from sampled frames plus any transcript.' }),
      check('5.4', 'Length vs retention', 'How Reel length relates to watch time and completion.', 'Finds the right length.', 'auto', { partial: 'Compares length with public views. Completion needs Insights.' }),
      check('5.5', 'Text, captions and safe zones', 'On-screen captions, readability, and text clear of Instagram\'s buttons.', 'Many people watch muted.', 'ai', { partial: 'Judged from sampled frames.' }),
      check('5.6', 'Audio', 'Trending audio, original audio and voice-over quality.', 'Audio affects reach and watch time.', 'ai', { partial: 'Uses public music data. Sound quality is not heard unless a transcript implies it.' }),
      check('5.7', 'Cover and thumbnail', 'Covers that read well on the grid and in the Reels tab.', 'Covers drive clicks from the profile.', 'ai'),
      check('5.8', 'Production quality', 'Lighting, sound, framing, 9:16 format, resolution.', 'Poor quality raises skip rates.', 'ai', { partial: 'Format and resolution are measured. Lighting and framing come from sampled frames.' }),
      check('5.9', 'Branding in content', 'Logo, colours, fonts and recognisable visual cues.', 'Viewers should know it is you.', 'ai'),
      check('5.10', 'Faces and people', 'Use of founders, staff, customers and creators on camera.', 'Faces often lift retention.', 'ai'),
    ],
  },
  {
    id: 6, title: 'Carousels, posts and Stories', weight: 8,
    checks: [
      check('6.1', 'Carousel performance', 'Views, saves, shares and follows per carousel, and slide count against results.', 'Often the highest-saving format.', 'auto', { partial: 'Uses public likes, comments and slide count. Views, saves and shares need Insights.' }),
      check('6.2', 'Carousel design', 'First-slide hook, readability, and a reason to swipe.', 'The first slide decides whether people swipe.', 'ai', { partial: 'Only first slides are reviewed.' }),
      check('6.3', 'Single-image posts', 'Reach and engagement compared with other formats.', 'Shows whether images earn their place.', 'auto', { partial: 'Uses public engagement. Reach needs Insights.' }),
      check('6.4', 'Story reach', 'Story views as a share of followers.', 'Shows how many loyal followers you reach.', 'manual', { input: percentInput('Story views ÷ followers', [[10, 90], [5, 75], [2.5, 50], [1, 30], [-Infinity, 15]]) }),
      check('6.5', 'Story navigation', 'Taps forward, taps back, exits and next-story swipes.', 'Shows where sequences lose people.', 'manual'),
      check('6.6', 'Story interaction', 'Replies, sticker taps and link clicks.', 'Deepens relationships and drives traffic.', 'manual'),
      check('6.7', 'Story frequency', 'Days per week with Stories and frames per day.', 'Regular Stories keep you top of mind.', 'manual'),
      check('6.8', 'Lives and Broadcast channels', 'Use, attendance, peak viewers and follow-up.', 'High-trust formats for launches.', 'manual'),
    ],
  },
  {
    id: 7, title: 'Engagement and community', weight: 8,
    checks: [
      check('7.1', 'Engagement rate', 'Interactions divided by reach and by views, by format and over time.', 'A fairer measure than likes alone.', 'auto', { partial: 'Uses followers and public views. Reach needs Insights.' }),
      check('7.2', 'Comment quality', 'Real conversation compared with emoji-only or spam comments.', 'Meaningful comments show interest.', 'auto', { partial: 'From sampled comments.' }),
      check('7.3', 'Reply rate and speed', 'Share of comments answered and average response time.', 'Fast replies boost conversation.', 'manual', { hint: 'Check the comments on recent posts.' }),
      check('7.4', 'DM handling', 'Response time, saved replies, and clear next steps.', 'DMs are where many sales start.', 'manual'),
      check('7.5', 'Sentiment', 'Positive, neutral and negative tone across comments.', 'Early warning for problems.', 'ai', { partial: 'From sampled comments. Mentions by others are not collected.' }),
      check('7.6', 'Questions and objections', 'What people keep asking or doubting.', 'Each one is a content idea or sales blocker.', 'ai', { partial: 'From sampled comments.' }),
      check('7.7', 'User-generated content', 'Tags, mentions and customer content, and whether it is reshared.', 'Customer content is believable proof.', 'ai', { partial: 'Only reshares visible on the account. The tagged tab is not collected.' }),
      check('7.8', 'Community management', 'Pinned comments, hidden spam, moderation and keyword filters.', 'A clean comment section protects the brand.', 'manual'),
    ],
  },
  {
    id: 8, title: 'Discoverability and search', weight: 8,
    checks: [
      check('8.1', 'Keyword use', 'Search terms in captions, on-screen text, spoken words, name field and bio.', 'Keywords match you to searches.', 'ai', { partial: 'Spoken words are included only when transcripts are on.' }),
      check('8.2', 'Hashtag strategy', 'Number, relevance and size of hashtags, and banned or spammy tags.', 'Relevant tags categorise content.', 'auto', { partial: 'Measures number and repetition. Tag size and banned status are not checked.' }),
      check('8.3', 'Alt text and location tags', 'Custom alt text and location tags for local businesses.', 'Improves accessibility and local discovery.', 'auto'),
      check('8.4', 'Traffic sources', 'Share of views from Home, Reels tab, Explore, search and profile.', 'Shows where growth comes from.', 'manual'),
      check('8.5', 'Collaborations', 'Collab posts with creators, partners and customers, and reach added.', 'Puts you in front of a trusting audience.', 'auto', { partial: 'Counts visible collabs and tags. Reach added needs Insights.' }),
      check('8.6', 'Trial Reels and testing', 'Whether content is tested with non-followers first.', 'Testing speeds up learning.', 'manual'),
      check('8.7', 'Recommendation eligibility', 'Whether Account Status shows ineligible content.', 'Ineligible content will not reach non-followers.', 'manual'),
    ],
  },
  {
    id: 9, title: 'Conversion and funnel', weight: 10,
    checks: [
      check('9.1', 'Profile visit rate', 'Profile visits per 1,000 views.', 'Shows whether content creates curiosity.', 'manual', { input: { kind: 'number', unit: 'per 1,000', label: 'Profile visits per 1,000 views', bands: [[20, 90], [10, 75], [5, 50], [2, 30], [-Infinity, 15]] } }),
      check('9.2', 'Follow rate', 'New follows per profile visit.', 'Shows whether the profile convinces.', 'manual', { input: percentInput('Follows ÷ profile visits', [[20, 90], [10, 75], [5, 50], [2, 30], [-Infinity, 15]]) }),
      check('9.3', 'Link and button clicks', 'Link taps, contact button taps and Story link clicks.', 'The first measurable step towards revenue.', 'manual'),
      check('9.4', 'Calls to action', 'How often posts ask for action, what they ask, and where.', 'People act more when told what to do.', 'auto', { partial: 'Reads captions. Spoken or on-screen asks are not counted.' }),
      check('9.5', 'Lead capture', 'Comment-to-DM automations, lead forms, lead magnets and booking links.', 'Turns attention into leads.', 'ai', { partial: 'Inferred from captions and the link page. Automations cannot be seen directly.' }),
      check('9.6', 'Shopping setup', 'Product tags, shop, catalogue health and checkout path.', 'Reduces the steps to buying.', 'manual'),
      check('9.7', 'Landing experience', 'Mobile speed, message match with the post, and friction.', 'Clicks are wasted if the page disappoints.', 'auto', { partial: 'Measures server response and mobile setup, not real phone speed or friction.' }),
      check('9.8', 'Revenue attribution', 'UTM tags, discount codes and analytics that link sales to Instagram.', 'Without tracking, value is guesswork.', 'auto', { partial: 'Detects tags on the link page. Tag managers can hide them, and sales data needs the client.' }),
    ],
  },
  {
    id: 10, title: 'Competitor benchmark', weight: 6,
    checks: [
      check('10.1', 'Growth and size', 'Followers and growth rate over the review period.', 'Shows who is gaining ground.', 'auto', { partial: 'Growth appears once daily tracking has 7 days.' }),
      check('10.2', 'Posting cadence and format mix', 'Posts per week and share of each format.', 'Shows how hard competitors work the channel.', 'auto'),
      check('10.3', 'Public engagement', 'Visible views, likes and comments relative to size.', 'Puts your numbers in context.', 'auto'),
      check('10.4', 'Top-performing content', 'Each competitor\'s outlier posts and what makes them work.', 'Patterns you can adapt, not copy.', 'ai'),
      check('10.5', 'Positioning and offers', 'Their promise, pricing cues, offers and calls to action.', 'Shows where you can stand out.', 'ai'),
      check('10.6', 'Content gaps', 'Questions their audiences ask that nobody answers well.', 'Opportunities to own a topic.', 'ai'),
      check('10.7', 'Share of voice', 'How often each brand is mentioned or tagged in the niche.', 'Shows who owns the conversation.', 'auto', { partial: 'Counts mentions only within collected posts and comments, not the whole niche.' }),
    ],
  },
  {
    id: 11, title: 'Paid and partnerships', weight: 4,
    checks: [
      check('11.1', 'Boosted posts and ads', 'Which posts are promoted, cost per result, and organic winners used as ads.', 'Your best organic content is usually your best ad.', 'manual', { hint: 'Needs access to ad results.' }),
      check('11.2', 'Competitor ads', 'Active competitor ads, creative and offers from the Meta Ad Library.', 'Shows what competitors pay to say.', 'manual', { hint: 'Use the Meta Ad Library links shown in the competitor benchmark section.' }),
      check('11.3', 'Partnership ads and creators', 'Creator collaborations, partnership ads and results.', 'Creator content often outperforms brand content.', 'manual'),
      check('11.4', 'Creative fatigue', 'How long ads run and whether results decline.', 'Tired creative raises costs.', 'manual'),
    ],
  },
  {
    id: 12, title: 'Account health and brand safety', weight: 4,
    checks: [
      check('12.1', 'Account Status', 'Removed content, restrictions or recommendation limits.', 'Restrictions can silently reduce reach.', 'manual'),
      check('12.2', 'Music and copyright', 'Commercially licensed audio on a business account, and muted posts.', 'Unlicensed audio can mean takedowns.', 'manual', { hint: 'The report lists public music data on sampled Reels where available.' }),
      check('12.3', 'Disclosure and claims', 'Paid partnership labels, and whether claims can be backed up.', 'Protects you under advertising rules.', 'ai', { partial: 'Reviews caption wording only. This is not legal advice.' }),
      check('12.4', 'Security and access', 'Two-factor authentication, admin access, and Business Suite roles.', 'Lost access is expensive.', 'manual'),
      check('12.5', 'Accessibility', 'Captions, alt text, colour contrast and readable font sizes.', 'Reaches more people.', 'ai', { partial: 'Judged from sampled frames and alt text data.' }),
    ],
  },
  {
    id: 13, title: 'Tracking and reporting setup', weight: 2,
    checks: [
      check('13.1', 'Professional account and Insights', 'Account type, and Insights for the full review period.', 'Needed for accurate measurement.', 'auto', { partial: 'Account type is public. Insights availability needs the client.' }),
      check('13.2', 'Meta Pixel and Conversions API', 'Whether website events are tracked for Instagram traffic.', 'Links content and ads to sales.', 'auto', { partial: 'Detects a Pixel on the link page only. Conversions API runs on servers and cannot be seen.' }),
      check('13.3', 'UTM and analytics', 'Consistent UTM tags and an analytics tool that receives them.', 'Shows which posts drive visits.', 'auto', { partial: 'Checks the bio link and page only.' }),
      check('13.4', 'Reporting rhythm', 'Who reviews which numbers, and how often.', 'Regular review turns data into decisions.', 'manual'),
    ],
  },
];

// The same framework serves two audiences. Each mode sets its own pillar weights, and a pillar
// weighted 0 is left out of that mode entirely. Titles change where the meaning changes.
export const MODES = {
  business: {
    label: 'Business',
    weights: { 1: 8, 2: 8, 3: 10, 4: 14, 5: 10, 6: 8, 7: 8, 8: 8, 9: 10, 10: 6, 11: 4, 12: 4, 13: 2 },
    titles: {},
    rivals: 'Competitors',
  },
  creator: {
    label: 'Creator',
    weights: { 1: 8, 2: 10, 3: 12, 4: 18, 5: 16, 6: 8, 7: 10, 8: 8, 9: 2, 10: 4, 11: 4, 12: 0, 13: 0 },
    titles: { 10: 'Similar creators', 11: 'Brand-deal readiness' },
    rivals: 'Similar creators',
  },
};

export const modeOf = (report) => (report?.audienceType === 'creator' ? 'creator' : 'business');

/** The pillars that count in a mode, with that mode's weights and titles. */
export function pillarsFor(mode = 'business') {
  const settings = MODES[mode] ?? MODES.business;
  return PILLARS
    .map((pillar) => ({ ...pillar, weight: settings.weights[pillar.id] ?? 0, title: settings.titles[pillar.id] ?? pillar.title }))
    .filter((pillar) => pillar.weight > 0);
}

export const ALL_CHECKS = PILLARS.flatMap((pillar) => pillar.checks.map((item) => ({ ...item, pillarId: pillar.id })));
export const AI_CHECK_IDS = ALL_CHECKS.filter((item) => item.source === 'ai').map((item) => item.id);
export const CHECK_BY_ID = new Map(ALL_CHECKS.map((item) => [item.id, item]));

export function ratingFor(score) {
  if (score >= 85) return { key: 'strong', label: 'Strong', meaning: 'Keep doing what works and scale it.' };
  if (score >= 65) return { key: 'healthy', label: 'Healthy', meaning: 'Good base; a few fixes will unlock growth.' };
  if (score >= 40) return { key: 'needs_work', label: 'Needs work', meaning: 'Clear gaps holding back reach or sales.' };
  return { key: 'critical', label: 'Critical', meaning: 'Fix before investing more in content or ads.' };
}

export function scoreFromNumber(input, value) {
  for (const [limit, score] of input.bands) {
    if (input.lowerIsBetter ? value <= limit : value >= limit) return score;
  }
  return input.bands.at(-1)[1];
}
