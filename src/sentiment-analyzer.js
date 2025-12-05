const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const Sentiment = require('sentiment');
const { generateHTMLReport } = require('./report-generator');
const { generateMarkdownReport } = require('./markdown-generator');

// Configuration
const CONFIG = {
  inputCSV: process.argv[2] || 'sample-urls.csv',
  outputHTML: process.argv[3] || 'sentiment-report.html',
  searchTerm: process.argv[4] || 'Cambria',
  maxUrls: parseInt(process.argv[5]) || 100, // Limit to top N URLs (after filtering)
  maxUrlsToFetch: parseInt(process.argv[5]) ? parseInt(process.argv[5]) + 50 : 150, // Fetch more URLs to account for stock/finance filtering
  requestTimeout: 10000,
  delayBetweenRequests: 1000,
  requireMention: false,
};

// Stock and finance domains to skip (not real brand content)
const STOCK_FINANCE_DOMAINS = [
  'finance.yahoo.com',
  'stockanalysis.com',
  'seekingalpha.com',
  'marketwatch.com',
  'tradingview.com',
  'morningstar.com',
  'morningstar.co.uk',
  'morningstar.au',
  'finviz.com',
  'investing.com',
  'gurufocus.com',
  'tipranks.com',
  'marketbeat.com',
  'fool.com',
  'markets.businessinsider.com',
  'benzinga.com',
  'zacks.com',
  'stocktwits.com',
  'barchart.com',
  'nasdaq.com/market-activity',
  'wsj.com/market-data',
  'bloomberg.com/quote',
  'reuters.com/markets/companies',
  'cnbc.com/quotes',
  'cnn.com/markets/stocks',
  'google.com/finance',
  'dividendmax.com',
  'stocktitan.net',
  'simplywall.st',
  'insidertrades.com',
  'craft.co',
  'datanyze.com',
  'cbinsights.com',
  'apps.apple.com',
  'play.google.com',
  'ts2.tech', // Stock/financial news site often misclassified
];

// Check if URL is a stock/finance page
function isStockFinancePage(url) {
  const urlLower = url.toLowerCase();
  
  // Explicit stock keywords in URL
  if (urlLower.includes('share-price') || urlLower.includes('stock-price') || urlLower.includes('market-updates')) {
    return true;
  }

  return STOCK_FINANCE_DOMAINS.some(domain => urlLower.includes(domain));
}

// Specific domains to exclude from analysis
const EXCLUDED_DOMAINS = [
  'nexaexperience.com',
  'marutisuzukitruevalue.com',
  'marutisuzukidrivingschool.com',
  'marutisuzukicommercial.com',
  'screener.in',
];

// Check if URL matches an excluded domain
function isExcludedDomain(url) {
  const urlLower = url.toLowerCase();
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    return EXCLUDED_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch {
    // Invalid URL, check if domain appears in URL string
    return EXCLUDED_DOMAINS.some(domain => urlLower.includes(domain));
  }
}

// Language-specific domains/paths to exclude
const EXCLUDED_LANGUAGES = [
  '.ua/',           // Ukrainian sites
  '24tv.ua',        // Ukrainian news
  '.it/wiki',       // Italian Wikipedia
  'it.wikipedia',   // Italian Wikipedia
  '/hl/',           // Language parameter
  '?hl=',           // Language query parameter
  '&hl=',           // Language query parameter
  '/ua/',           // Ukrainian language path
  '/it/',           // Italian language path (in domain or path)
  '/tw/',           // Taiwanese/Chinese language path
  '/jp/',           // Japanese language path
  '/kr/',           // Korean language path
  '/th/',           // Thai language path
  '/ar/',           // Arabic language path
  '/fr-ma/',        // French Morocco
  '/es-mx/',        // Spanish Mexico
  '/pl/',           // Polish language path
  '/pt/',           // Portuguese language path
  'ru.wikipedia',   // Russian Wikipedia
  'fr.wikipedia',   // French Wikipedia
  'de.wikipedia',   // German Wikipedia
];

// Check if URL is a language-specific page to exclude
function isExcludedLanguagePage(url) {
  const urlLower = url.toLowerCase();
  
  // Check for excluded language patterns
  if (EXCLUDED_LANGUAGES.some(pattern => urlLower.includes(pattern))) {
    return true;
  }
  
  // Check for Italian subdomain (it.domain.com)
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    if (hostname.startsWith('it.') && hostname !== 'it.com') {
      return true;
    }
  } catch {
    // Invalid URL, skip
  }
  
  return false;
}

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Context-aware brand sentiment analyzer for healthcare/pharma
function analyzeBrandContext(text, brandName) {
  // Create flexible brand matching (e.g., "WKKellogg" matches "WK Kellogg", "Kellogg's", etc.)
  const brandVariations = [
    brandName,
    brandName.replace(/([A-Z])/g, ' $1').trim(), // "WKKellogg" -> "WK Kellogg"
    brandName.replace(/^WK/, 'WK '), // Handle WK prefix
    brandName.replace(/USA?$/i, ''), // Remove USA suffix
    brandName + "'s", // Add possessive
    brandName.replace(/^WK/i, '').trim(), // "WKKellogg" -> "Kellogg"
    brandName.replace(/^WK/i, '').trim() + "'s", // "Kellogg's"
  ];
  
  // Extract sentences containing any brand variation
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const brandRegex = new RegExp(brandVariations.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const brandSentences = sentences.filter(s => brandRegex.test(s));
  
  if (brandSentences.length === 0) {
    return { score: 0, classification: 'neutral', indicators: [] };
  }
  
  const brandContext = brandSentences.join(' ').toLowerCase();
  
  // Business-specific POSITIVE indicators (how brand is perceived)
  const positiveIndicators = [
    'approved', 'breakthrough', 'effective', 'innovative', 'leading', 'first',
    'superior', 'successful', 'advance', 'pioneer', 'develop', 'announce',
    'achieve', 'demonstrate', 'show', 'proven', 'award', 'excellence',
    'partner', 'collaboration', 'invest', 'expand', 'growth', 'milestone',
    'benefit', 'improve', 'help', 'treat', 'cure', 'relief', 'solution',
    // Automotive/promotional terms
    'limited edition', 'limited version', 'special edition', 'exclusive',
    'premium', 'launch', 'launched', 'introduced', 'debut', 'unveiled',
    // Quality/value justification terms
    'additional features', 'additional modes', 'worth the price', 'worth it',
    'quality', 'high quality', 'top quality', 'best in class', 'market leader',
    'recommend', 'recommended', 'trusted', 'reliable', 'durable'
  ];
  
  // Business-specific NEGATIVE indicators (actual criticism)
  // Note: Single price words removed - they're too context-dependent
  // Only use clear negative phrases or words that are unambiguously negative
  const negativeIndicators = [
    'recall', 'lawsuit', 'sued', 'litigation', 'penalty', 'fine', 'violation',
    'danger', 'dangerous', 'fatal', 'death', 'harm', 'injury', 'adverse',
    'fail', 'failed', 'reject', 'denied', 'controversy', 'scandal',
    'mislead', 'fraud', 'illegal', 'banned', 'prohibit', 'restrict',
    'shortage', 'unavailable', 'limited availability', 'limited stock', 
    'concern', 'worried', 'afraid',
    // Price criticism phrases - only clear negative phrases, not single words
    // Note: "expensive", "pricey", "costly" alone are NOT negative - they can be neutral/positive
    // when describing premium products or when defended ("not overpriced")
    'too expensive', 'overpriced', 'over priced', 'not worth the price',
    'not worth it', 'too costly', 'too pricey', 'unaffordable',
    'rip off', 'overcharge', 'over charge',
    'complaint', 'criticism', 'disappointed', 'disappointing'
  ];
  
  // Negation patterns that flip the meaning of negative words
  const negationPatterns = [
    'not to say',
    'not saying',
    "that's not to say",
    "thats not to say",
    'not necessarily',
    'not always',
    'not inevitably',
    'does not mean',
    "doesn't mean",
    'is not',
    "isn't",
    'are not',
    "aren't",
    'worth the',
    'justify',
    'justified',
    'justifies',
    'prevention',
    'protection',
    'security',
    'anti-',
    'avoid',
    'prevent',
    'protect',
    'report', // For "report fraud"
    'potential', // For "potential drawbacks" - neutralizes the following negative word
    'possible',  // Similar to potential
  ];

  // Neutral headings/structural terms (don't count these as negative)
  const neutralStructuralTerms = [
    'drawback',
    'drawbacks',
    'limitation',
    'limitations',
    'con', 
    'cons', // Pros and Cons
    'weakness',
    'weaknesses',
    'disadvantage',
    'disadvantages',
    'verdict',
    'conclusion',
    'summary'
  ];
  
  // NEUTRAL medical terms (don't count these as negative)
  const neutralMedical = [
    'weight loss', 'lose weight', 'obesity', 'overweight', 'diabetes',
    'side effect', 'adverse', 'patient', 'treatment', 'therapy',
    'disease', 'condition', 'symptom', 'dose', 'dosage', 'injection'
  ];
  
  // Count indicators in brand context
  let positiveCount = 0;
  let negativeCount = 0;
  const foundPositive = [];
  const foundNegative = [];
  
  // Helper function to create regex for word/phrase matching
  function createIndicatorRegex(indicator) {
    // Escape special regex characters
    const escaped = indicator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // For multi-word phrases, match the whole phrase; for single words, use word boundaries
    if (indicator.includes(' ')) {
      return new RegExp(`\\b${escaped}\\b`, 'gi');
    } else {
      return new RegExp(`\\b${escaped}\\b`, 'gi');
    }
  }
  
  positiveIndicators.forEach(word => {
    const regex = createIndicatorRegex(word);
    const matches = brandContext.match(regex);
    if (matches) {
      positiveCount += matches.length;
      if (!foundPositive.includes(word)) foundPositive.push(word);
    }
  });
  
  // Helper function to check if a negative word appears in a negated context
  function isNegatedContext(text, word) {
    // First check if the word is a structural term (like "drawbacks" in a header)
    if (neutralStructuralTerms.includes(word.toLowerCase())) {
      return true;
    }

    const wordIndex = text.toLowerCase().indexOf(word.toLowerCase());
    if (wordIndex === -1) return false;
    
    // Check the 100 characters before the word for negation patterns
    const contextBefore = text.substring(Math.max(0, wordIndex - 100), wordIndex).toLowerCase();
    
    // Check if any negation pattern appears before this word
    return negationPatterns.some(pattern => contextBefore.includes(pattern));
  }
  
  negativeIndicators.forEach(word => {
    const regex = createIndicatorRegex(word);
    const matches = brandContext.match(regex);
    if (matches) {
      // Check if each match is in a negated context
      let actualNegativeCount = 0;
      
      // Find all positions of this word in the text
      let searchText = brandContext.toLowerCase();
      let wordLower = word.toLowerCase();
      let pos = 0;
      
      while ((pos = searchText.indexOf(wordLower, pos)) !== -1) {
        if (!isNegatedContext(brandContext, word)) {
          actualNegativeCount++;
        }
        pos += wordLower.length;
      }
      
      if (actualNegativeCount > 0) {
        negativeCount += actualNegativeCount;
        if (!foundNegative.includes(word)) foundNegative.push(word);
      }
    }
  });
  
  // Calculate sentiment score based on brand context
  const score = positiveCount - (negativeCount * 2); // Weight negative more heavily
  
  // Classify based on indicators and context
  let classification = 'neutral';
  if (score >= 3 || (positiveCount >= 3 && negativeCount === 0)) {
    classification = 'positive';
  } else if (score < 0 || negativeCount >= 1) {
    classification = 'negative';
  }
  
  return {
    score,
    classification,
    positiveCount,
    negativeCount,
    positive: foundPositive,
    negative: foundNegative,
    brandSentences: brandSentences.length
  };
}

// Read URLs from CSV file
async function readURLsFromCSV(filePath) {
  return new Promise((resolve, reject) => {
    const urls = [];
    const seenUrls = new Set(); // Track unique URLs

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        // Try to find URL in common column names (including Ahrefs format)
        const url = row['Referring page URL'] || row['Referring page URL'] ||
                   row.url || row.URL || row.Url || row.link || row.Link || Object.values(row)[0];

        if (url && url.trim()) {
          const cleanUrl = url.trim();
          // Only add if not already seen (deduplication)
          if (!seenUrls.has(cleanUrl)) {
            seenUrls.add(cleanUrl);
            urls.push(cleanUrl);
          }
        }
      })
      .on('end', () => {
        console.log(`✓ Loaded ${urls.length} unique URLs from CSV (duplicates removed)`);
        resolve(urls);
      })
      .on('error', reject);
  });
}

// Fetch page content
async function fetchPageContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: CONFIG.requestTimeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      maxRedirects: 5,
    });
    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch: ${error.message}`);
  }
}

// Extract text content from HTML
function extractTextContent(html) {
  const $ = cheerio.load(html);

  // Remove unwanted elements
  $('script, style, nav, header, footer, iframe, noscript').remove();

  // Extract text from body
  const bodyText = $('body').text();

  // Clean up whitespace
  const cleanedText = bodyText
    .replace(/\s+/g, ' ')
    .trim();

  return cleanedText;
}

// Check if text mentions the search term
function mentionsSearchTerm(text, searchTerm) {
  const regex = new RegExp(searchTerm, 'gi');
  return regex.test(text);
}

// Extract excerpts containing the search term (short version for display)
function extractExcerpts(text, searchTerm, contextLength = 75) {
  const regex = new RegExp(`(.{0,${contextLength}}${searchTerm}.{0,${contextLength}})`, 'gi');
  const matches = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1].trim());
  }

  return matches;
}

// Count how many times the search term appears
function countMentions(text, searchTerm) {
  const regex = new RegExp(searchTerm, 'gi');
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

// Extract context around brand mentions for sentiment analysis
function extractBrandContext(text, searchTerm, contextLength = 300) {
  const regex = new RegExp(`(.{0,${contextLength}}${searchTerm}.{0,${contextLength}})`, 'gi');
  const contexts = [];
  let match;

  // Extract all contexts where brand is mentioned
  while ((match = regex.exec(text)) !== null) {
    contexts.push(match[1].trim());
  }

  // Combine all contexts into one string for analysis
  return contexts.join(' ');
}

// Analyze sentiment focusing on brand context (not used - replaced by context-aware)
function analyzeSentiment(text, searchTerm) {
  if (!text || text.trim().length === 0) {
    return null;
  }

  // Use context-aware analysis for brand perception
  const brandAnalysis = analyzeBrandContext(text, searchTerm);

  return {
    score: brandAnalysis.score,
    comparative: brandAnalysis.score / Math.max(brandAnalysis.brandSentences, 1),
    positive: brandAnalysis.positive,
    negative: brandAnalysis.negative,
    positiveCount: brandAnalysis.positiveCount,
    negativeCount: brandAnalysis.negativeCount,
    classification: brandAnalysis.classification
  };
}

// Classify sentiment based on context analysis
function classifySentiment(sentimentResult) {
  if (!sentimentResult) return 'unknown';
  // Use the context-aware classification
  return sentimentResult.classification || 'neutral';
}

// Generate concise rationale for brand sentiment
function generateSentimentRationale(sentimentResult, classification, text) {
  if (!sentimentResult) return '';

  const { positive, negative, positiveCount, negativeCount } = sentimentResult;

  if (classification === 'positive') {
    const topPositive = positive.slice(0, 3).join(', ');
    return `Favorable: Brand portrayed favorably (${topPositive}). ${positiveCount} positive indicators.`;
  }

  if (classification === 'negative') {
    const topNegative = negative.slice(0, 3).join(', ');
    return `Unfavorable: Critical context detected (${topNegative}). ${negativeCount} concern indicators.`;
  }

  return `Neutral: Factual/informational brand mention. ${positiveCount} positive, ${negativeCount} concern indicators.`;
}

// Generate detailed insights from all results
function generateDetailedInsights(results, searchTerm) {
  const successful = results.filter(r => r.status === 'success' && r.sentiment);
  const withMentions = results.filter(r => r.mentionsBrand);
  
  // Extract domains from URLs
  const getDomain = (url) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url;
    }
  };
  
  // Analyze domain patterns
  const domainMentions = {};
  const domainSentiments = {};
  
  results.forEach(result => {
    const domain = getDomain(result.url);
    
    if (result.mentionsBrand) {
      domainMentions[domain] = (domainMentions[domain] || 0) + result.mentionCount;
      
      if (result.classification) {
        if (!domainSentiments[domain]) {
          domainSentiments[domain] = { positive: 0, neutral: 0, negative: 0 };
        }
        domainSentiments[domain][result.classification]++;
      }
    }
  });
  
  // Get top domains by mention count
  const topDomains = Object.entries(domainMentions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count, sentiment: domainSentiments[domain] }));
  
  // Analyze sentiment distribution by mention frequency
  const highMentionPages = withMentions.filter(r => r.mentionCount >= 3);
  const lowMentionPages = withMentions.filter(r => r.mentionCount < 3 && r.mentionCount > 0);
  
  // Identify key patterns
  const insights = {
    topDomains,
    totalPages: results.length,
    successfulPages: successful.length,
    pagesWithMentions: withMentions.length,
    highMentionPages: highMentionPages.length,
    lowMentionPages: lowMentionPages.length,
    
    // Sentiment breakdown
    positive: successful.filter(r => r.classification === 'positive').length,
    neutral: successful.filter(r => r.classification === 'neutral').length,
    negative: successful.filter(r => r.classification === 'negative').length,
    
    // High mention sentiment
    highMentionSentiment: {
      positive: highMentionPages.filter(r => r.classification === 'positive').length,
      neutral: highMentionPages.filter(r => r.classification === 'neutral').length,
      negative: highMentionPages.filter(r => r.classification === 'negative').length,
    },
  };
  
  return insights;
}

// Generate context-aware AI recommendations based on sentiment analysis
function generateImprovementSuggestions(sentimentResult, classification, url, excerpts, searchTerm) {
  const suggestions = [];
  
  if (!sentimentResult) {
    return ['Page inaccessible or no relevant content. Consider alternative outreach channels.'];
  }

  const { positive, negative, negativeCount, positiveCount } = sentimentResult;
  const brandName = searchTerm || 'the brand';

  if (classification === 'negative') {
    // Unfavorable: Specific improvement suggestions based on detected issues
    suggestions.push('🔴 **Action Required**: Address negative brand perception on this page.');
    
    if (negative && negative.length > 0) {
      const topIssues = negative.slice(0, 3).join(', ');
      suggestions.push(`**Issues Detected**: Content contains concerning terms (${topIssues}). Consider reaching out to the content owner with factual corrections or updated information.`);
    }
    
    suggestions.push(`**Recommended Response**: Prepare a counter-narrative with positive customer testimonials, case studies, or official statements to address the concerns raised about ${brandName}.`);
    suggestions.push('**Outreach Strategy**: Contact the site owner professionally, acknowledge their perspective, and offer to provide accurate, updated information or exclusive content.');
    
  } else if (classification === 'neutral') {
    // Neutral: Enhancement suggestions to convert to favorable
    suggestions.push('🟡 **Opportunity**: Content is factual but lacks brand advocacy.');
    
    if (positiveCount === 0) {
      suggestions.push(`**Enhancement Needed**: This page mentions ${brandName} without highlighting differentiators. Provide the content creator with compelling value propositions, unique features, or customer success stories.`);
    } else {
      suggestions.push(`**Partial Success**: Some positive aspects detected (${positive ? positive.slice(0, 2).join(', ') : 'general mentions'}), but overall tone remains neutral. Share additional proof points to strengthen brand perception.`);
    }
    
    suggestions.push('**Content Ideas**: Offer exclusive quotes, industry insights, product comparisons, or customer case studies that showcase brand leadership.');
    suggestions.push('**Relationship Building**: Engage with the content creator through social media or direct outreach to establish an ongoing relationship for future positive coverage.');
    
  } else if (classification === 'positive') {
    // Favorable: Reinforce what's working well
    suggestions.push('🟢 **Excellent Coverage**: This content portrays the brand favorably.');
    
    if (positive && positive.length > 0) {
      const highlights = positive.slice(0, 4).join(', ');
      suggestions.push(`**Strengths Highlighted**: The content emphasizes positive attributes (${highlights}). These talking points resonate well and should be amplified in marketing materials.`);
    }
    
    suggestions.push(`**Leverage Opportunity**: Share this positive coverage across ${brandName}'s social channels, include in press kits, and reference in sales materials as third-party validation.`);
    suggestions.push('**Relationship Value**: This content creator is a potential brand advocate. Build a stronger relationship through exclusive access, early product announcements, or collaboration opportunities.');
  }

  return suggestions.slice(0, 4);
}

// Generate opportunity JSON in required schema format
function generateOpportunityJSON(reportData) {
  const { searchTerm, timestamp, results, summary, insights, title, sourceDescription } = reportData;
  
  // Focus ONLY on pages that mention the brand (actionable)
  const withBrandMention = results.filter(r => r.status === 'success' && r.mentionsBrand);
  const positive = withBrandMention.filter(r => r.classification === 'positive').length;
  const negative = withBrandMention.filter(r => r.classification === 'negative').length;
  const neutral = withBrandMention.filter(r => r.classification === 'neutral').length;
  
  const avgScore = withBrandMention.length > 0 
    ? withBrandMention.reduce((sum, r) => sum + r.sentiment.score, 0) / withBrandMention.length 
    : 0;
  
  const positivePercent = withBrandMention.length > 0 ? (positive / withBrandMention.length * 100).toFixed(1) : 0;
  
  // Build detailed table for suggestions (properly formatted markdown)
  // Sort by mention count descending before generating table
  const sortedResults = results
    .filter(r => r.status === 'success' && r.mentionsBrand)
    .sort((a, b) => b.mentionCount - a.mentionCount);

  const tableRows = sortedResults
    .map(result => {
      const sentimentBadge = result.classification === 'positive' ? '🟢 Favorable' :
                             result.classification === 'negative' ? '🔴 Unfavorable' : '🟡 Neutral';
      const mention = result.mentionsBrand ? `Yes (${result.mentionCount}x)` : 'No';
      
      // Format AI recommendation for JSON output
      const aiRecommendation = result.suggestions && result.suggestions.length > 0 
        ? result.suggestions.map(s => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' ')
        : '-';
      
      return `| ${result.url} | ${sentimentBadge} | **${mention}** | ${result.rationale} | ${aiRecommendation} |`;
    })
    .join('\n');
  
  const suggestionValue = `## Top ${summary.withMentions} Referring Domains\n\n| Referring Domain | Sentiment Analysis | Brand Mention | Rationale | AI Recommendation |\n|-----|-----------|---------------|-----------|---------|\n${tableRows}`;
  
  return {
    opportunity: {
      id: `opp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      siteId: `site-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      runbook: "https://adobe.sharepoint.com/sites/backlink-sentiment-analysis",
        type: "generic-opportunity",
        data: {
          dataSources: ["Site"]
        },
      origin: "ESS_OPS",
      title: title || "[Beta] Backlink Sentiment Analysis",
      description: `This audit analyzes sentiment around brand mentions across ${sourceDescription || 'backlink sources'} to assess brand perception and content quality. Using context-aware sentiment analysis, we evaluated ${summary.successful} referring domains and found ${summary.withMentions} pages actively mentioning ${searchTerm}. This analysis focuses on how ${searchTerm} is portrayed in external content, highlighting opportunities and potential reputation risks.`,
      guidance: {
        recommendations: [
          {
            insight: `Brand Mention Health: ${summary.withMentions} pages actively mention ${searchTerm} (${positivePercent > 70 ? 'Very good' : positivePercent > 40 ? 'Good' : positivePercent > 10 ? 'Fair' : 'Limited'} sentiment: ${positive} positive, ${neutral} neutral, ${negative} negative).`,
            recommendation: null,
            type: null,
            rationale: withBrandMention.length === 0
              ? `No pages actively mention ${searchTerm}. Outreach needed to build brand presence.`
              : negative > 0 
                ? `${negative} pages show negative brand perception. ${neutral} neutral pages present opportunity for enhancement.`
                : positive > 0 && neutral > 0
                  ? `${positive} positive mentions with ${neutral} neutral pages presenting enhancement opportunities.`
                  : positive > 0
                    ? `Strong brand sentiment with ${positive} positive mentions. Focus on maintaining positive perception.`
                    : `Predominantly neutral/factual coverage. ${neutral} pages lack strong brand advocacy - opportunity for enhanced brand positioning.`
          },
          {
            insight: `${summary.withMentions} of ${summary.successful} pages actively mention ${searchTerm}. ${insights.topDomains.length > 0 ? `Top referrer: ${insights.topDomains[0].domain} (${insights.topDomains[0].count}x mentions).` : ''} ${insights.highMentionPages > 0 ? `${insights.highMentionPages} high-impact pages with 3+ mentions.` : ''}`,
            recommendation: null,
            type: null,
            rationale: null
          },
          {
            insight: null,
            recommendation: negative > 0 
              ? `Address ${negative} negative brand mention${negative > 1 ? 's' : ''} immediately to improve brand perception.`
              : neutral > 0
                ? `Enhance ${neutral} neutral brand mention${neutral > 1 ? 's' : ''} to increase positive advocacy.`
                : positive > 0
                  ? `Continue monitoring and maintaining positive brand mentions.`
                  : `Build brand mention strategy to increase presence.`,
            type: null,
            rationale: null
          },
          {
            insight: `${summary.successful - summary.withMentions} backlink pages analyzed do not mention ${searchTerm}.`,
            recommendation: `${positive > 0 ? `Leverage ${positive} positive brand mention${positive > 1 ? 's' : ''} in marketing materials. ` : ''}${summary.successful - summary.withMentions > 0 ? `Outreach to ${summary.successful - summary.withMentions} non-mentioning referring sites to add ${searchTerm} brand presence and increase visibility.` : ''}`,
            type: null,
            rationale: null
          }
        ]
      },
      tags: ["Off-Site", "isElmo"],
      status: "NEW",
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedBy: "backlink-sentiment-analyzer@1.0.0"
    },
    suggestions: [
      {
        id: `sug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        opportunityId: `opp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: "CONTENT_UPDATE",
        rank: 1,
        status: "NEW",
        data: {
          recommendations: [
            {
              pageUrl: null,
              id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              altText: null,
              imageUrl: null
            }
          ],
          suggestionValue
        },
        kpiDeltas: {
          estimatedKPILift: 0
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedBy: "backlink-sentiment-analyzer@1.0.0"
      }
    ]
  };
}

// Process a single URL
async function processURL(url, index, total) {
  console.log(`[${index + 1}/${total}] Processing: ${url}`);

  const result = {
    url,
    status: 'success',
    error: null,
    mentionsBrand: false,
    mentionCount: 0,
    textLength: 0,
    excerpts: [],
    sentiment: null,
    classification: null,
    rationale: '',
    suggestions: [],
  };

  try {
    // Fetch page content
    const html = await fetchPageContent(url);

    // Extract text
    const text = extractTextContent(html);
    result.textLength = text.length;

    // Check for brand mentions
    result.mentionsBrand = mentionsSearchTerm(text, CONFIG.searchTerm);
    result.mentionCount = countMentions(text, CONFIG.searchTerm);

    if (result.mentionsBrand) {
      result.excerpts = extractExcerpts(text, CONFIG.searchTerm);

      // Analyze brand sentiment using context-aware analysis
      result.sentiment = analyzeSentiment(text, CONFIG.searchTerm);
      result.classification = classifySentiment(result.sentiment);
      result.rationale = generateSentimentRationale(result.sentiment, result.classification, text);
      
      // Generate context-aware AI recommendations
      result.suggestions = generateImprovementSuggestions(result.sentiment, result.classification, url, result.excerpts, CONFIG.searchTerm);
    } else {
      // If brand not mentioned, analyze full text but note it
      if (!CONFIG.requireMention) {
        result.sentiment = analyzeSentiment(text, CONFIG.searchTerm);
        result.classification = classifySentiment(result.sentiment);
        result.rationale = `No brand mention detected. Page sentiment is ${result.classification} but not relevant to brand analysis.`;
        result.suggestions = ['No brand mention found - consider outreach to get brand coverage on this site'];
      } else {
        result.status = 'skipped';
        result.error = `No mention of "${CONFIG.searchTerm}" found`;
        result.suggestions = ['No brand mention found'];
      }
    }

  } catch (error) {
    result.status = 'error';
    result.error = error.message;
    console.log(`  ✗ Error: ${error.message}`);
  }

  return result;
}

// Main function
async function main() {
  console.log('='.repeat(60));
  console.log('Backlink Sentiment Analyzer');
  console.log('='.repeat(60));
  console.log(`Search term: ${CONFIG.searchTerm}`);
  console.log(`Input CSV: ${CONFIG.inputCSV}`);
  console.log(`Output HTML: ${CONFIG.outputHTML}`);
  console.log('='.repeat(60));
  console.log();

  try {
    // Check if input file exists
    if (!fs.existsSync(CONFIG.inputCSV)) {
      console.error(`Error: Input file "${CONFIG.inputCSV}" not found`);
      console.log('\nUsage: node analyzer.js <input.csv> [output.html]');
      process.exit(1);
    }

    // Read URLs from CSV
    const allUrls = await readURLsFromCSV(CONFIG.inputCSV);

    if (allUrls.length === 0) {
      console.error('Error: No URLs found in CSV file');
      process.exit(1);
    }

    // Filter out stock/finance pages first
    const candidateUrls = allUrls.slice(0, CONFIG.maxUrlsToFetch);
    const afterStockFilter = candidateUrls.filter(url => !isStockFinancePage(url));
    const skippedStock = candidateUrls.length - afterStockFilter.length;
    
    if (skippedStock > 0) {
      console.log(`ℹ️  Skipped ${skippedStock} stock/finance pages (not real brand content)`);
    }

    // Filter out excluded domains
    const afterDomainFilter = afterStockFilter.filter(url => !isExcludedDomain(url));
    const skippedDomains = afterStockFilter.length - afterDomainFilter.length;
    
    if (skippedDomains > 0) {
      console.log(`ℹ️  Skipped ${skippedDomains} excluded domain(s)`);
    }

    // Filter out language-specific pages (tw, jp, kr, ar, it, ua, fr, de, pl, pt, th, etc.)
    const filteredUrls = afterDomainFilter.filter(url => !isExcludedLanguagePage(url));
    const skippedLanguage = afterDomainFilter.length - filteredUrls.length;
    
    if (skippedLanguage > 0) {
      console.log(`ℹ️  Skipped ${skippedLanguage} non-English language pages (tw, jp, kr, ar, it, ua, etc.)`);
    }

    // Limit to top N URLs after filtering
    const urls = filteredUrls.slice(0, CONFIG.maxUrls);
    
    if (allUrls.length > CONFIG.maxUrls) {
      console.log(`ℹ️  Analyzing top ${urls.length} URLs from ${allUrls.length} total found`);
    }

    console.log();

    // Process each URL
    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const result = await processURL(urls[i], i, urls.length);
      results.push(result);

      // Delay between requests to be polite
      if (i < urls.length - 1) {
        await delay(CONFIG.delayBetweenRequests);
      }
    }

    console.log();
    console.log('='.repeat(60));
    console.log('Processing Complete');
    console.log('='.repeat(60));

    // Calculate summary statistics
    const successful = results.filter(r => r.status === 'success' && r.sentiment);
    const errors = results.filter(r => r.status === 'error');
    const skipped = results.filter(r => r.status === 'skipped');
    const withMentions = results.filter(r => r.mentionsBrand);

    console.log(`Total URLs processed: ${results.length}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Errors: ${errors.length}`);
    console.log(`Skipped: ${skipped.length}`);
    console.log(`Pages mentioning "${CONFIG.searchTerm}": ${withMentions.length}`);
    console.log();

    if (successful.length > 0) {
      const avgScore = successful.reduce((sum, r) => sum + r.sentiment.score, 0) / successful.length;
      const avgComparative = successful.reduce((sum, r) => sum + r.sentiment.comparative, 0) / successful.length;

      const positive = successful.filter(r => r.classification === 'positive').length;
      const negative = successful.filter(r => r.classification === 'negative').length;
      const neutral = successful.filter(r => r.classification === 'neutral').length;

      console.log('Sentiment Summary:');
      console.log(`  Average Score: ${avgScore.toFixed(2)}`);
      console.log(`  Average Comparative: ${avgComparative.toFixed(4)}`);
      console.log(`  Positive: ${positive} (${(positive / successful.length * 100).toFixed(1)}%)`);
      console.log(`  Neutral: ${neutral} (${(neutral / successful.length * 100).toFixed(1)}%)`);
      console.log(`  Negative: ${negative} (${(negative / successful.length * 100).toFixed(1)}%)`);
    }

    console.log();
    console.log('Generating reports...');

    // Generate detailed insights
    const insights = generateDetailedInsights(results, CONFIG.searchTerm);

    // Prepare report data
    const reportData = {
      searchTerm: CONFIG.searchTerm,
      timestamp: new Date().toISOString(),
      results,
      summary: {
        total: results.length,
        successful: successful.length,
        errors: errors.length,
        skipped: skipped.length,
        withMentions: withMentions.length,
      },
      insights,
    };

    const isCitedAnalysis = CONFIG.inputCSV.includes('cited') || CONFIG.outputHTML.includes('cited');
    const reportTitle = isCitedAnalysis ? '[Beta] Top Cited URLs Sentiment Analysis' : '[Beta] Backlink Sentiment Analysis';
    const sourceDescription = isCitedAnalysis ? 'top cited URLs' : 'backlink sources';

    // Generate Opportunity JSON
    const jsonPath = CONFIG.outputHTML.replace('.html', '.json');
    const opportunityData = generateOpportunityJSON({
      ...reportData,
      title: reportTitle,
      sourceDescription: sourceDescription
    });
    fs.writeFileSync(jsonPath, JSON.stringify(opportunityData, null, 2), 'utf8');
    console.log(`✓ JSON report saved to: ${jsonPath}`);

    // Generate HTML report
    generateHTMLReport({
      ...reportData,
      title: reportTitle
    }, CONFIG.outputHTML);
    console.log(`✓ HTML report saved to: ${CONFIG.outputHTML}`);

    // Generate Markdown report
    const markdownPath = CONFIG.outputHTML.replace('.html', '.md');
    generateMarkdownReport({
      ...reportData,
      title: reportTitle
    }, markdownPath);
    console.log(`✓ Markdown report saved to: ${markdownPath}`);
    console.log();

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the analyzer
main();

