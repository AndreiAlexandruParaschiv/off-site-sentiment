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
  maxUrls: 100, // Limit to top 100 URLs (after filtering)
  maxUrlsToFetch: 150, // Fetch more URLs to account for stock/finance filtering
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
  'crunchbase.com/organization'
];

// Check if URL is a stock/finance page
function isStockFinancePage(url) {
  const urlLower = url.toLowerCase();
  return STOCK_FINANCE_DOMAINS.some(domain => urlLower.includes(domain));
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
  
  // Healthcare-specific POSITIVE indicators (how brand is perceived)
  const positiveIndicators = [
    'approved', 'breakthrough', 'effective', 'innovative', 'leading', 'first',
    'superior', 'successful', 'advance', 'pioneer', 'develop', 'announce',
    'achieve', 'demonstrate', 'show', 'proven', 'award', 'excellence',
    'partner', 'collaboration', 'invest', 'expand', 'growth', 'milestone',
    'benefit', 'improve', 'help', 'treat', 'cure', 'relief', 'solution'
  ];
  
  // Healthcare-specific NEGATIVE indicators (actual criticism)
  const negativeIndicators = [
    'recall', 'lawsuit', 'sued', 'litigation', 'penalty', 'fine', 'violation',
    'danger', 'dangerous', 'fatal', 'death', 'harm', 'injury', 'adverse',
    'fail', 'failed', 'reject', 'denied', 'controversy', 'scandal',
    'mislead', 'fraud', 'illegal', 'banned', 'prohibit', 'restrict',
    'shortage', 'unavailable', 'limited', 'concern', 'worried', 'afraid',
    'expensive', 'costly', 'unaffordable', 'price', 'complaint', 'criticism'
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
  
  positiveIndicators.forEach(word => {
    const regex = new RegExp(`\\b${word}`, 'gi');
    const matches = brandContext.match(regex);
    if (matches) {
      positiveCount += matches.length;
      if (!foundPositive.includes(word)) foundPositive.push(word);
    }
  });
  
  negativeIndicators.forEach(word => {
    const regex = new RegExp(`\\b${word}`, 'gi');
    const matches = brandContext.match(regex);
    if (matches) {
      negativeCount += matches.length;
      if (!foundNegative.includes(word)) foundNegative.push(word);
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
    return `Positive: Brand portrayed favorably (${topPositive}). ${positiveCount} positive indicators.`;
  }

  if (classification === 'negative') {
    const topNegative = negative.slice(0, 3).join(', ');
    return `Negative: Critical context detected (${topNegative}). ${negativeCount} concern indicators.`;
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

// Generate improvement suggestions based on sentiment analysis (top 3 only)
function generateImprovementSuggestions(sentimentResult, classification, url, excerpts) {
  const suggestions = [];
  
  if (!sentimentResult) {
    return ['Page inaccessible or no relevant content'];
  }

  const { negative, negativeCount, positiveCount } = sentimentResult;

  if (classification === 'negative') {
    suggestions.push('🔴 *High Priority*: Address negative perception immediately');
    if (negativeCount > 3) {
      suggestions.push(`Counter negative terms: "${negative.slice(0, 2).join('", "')}"`);
    }
    suggestions.push('Engage content owner with positive updates/corrections');
    
  } else if (classification === 'neutral') {
    suggestions.push('🟡 *Medium Priority*: Enhance brand perception');
    suggestions.push('Provide compelling brand stories and value propositions');
    suggestions.push('Share customer success stories and testimonials');
    
  } else if (classification === 'positive') {
    suggestions.push('🟢 *Low Priority*: Maintain positive sentiment');
    suggestions.push('Leverage coverage in marketing materials');
    suggestions.push('Build relationship with content owner');
  }

  return suggestions.slice(0, 3);
}

// Generate opportunity JSON in required schema format
function generateOpportunityJSON(reportData) {
  const { searchTerm, timestamp, results, summary, insights } = reportData;
  const successful = results.filter(r => r.status === 'success' && r.sentiment);
  const positive = successful.filter(r => r.classification === 'positive').length;
  const negative = successful.filter(r => r.classification === 'negative').length;
  const neutral = successful.filter(r => r.classification === 'neutral').length;
  
  const avgScore = successful.length > 0 
    ? successful.reduce((sum, r) => sum + r.sentiment.score, 0) / successful.length 
    : 0;
  
  const positivePercent = successful.length > 0 ? (positive / successful.length * 100).toFixed(1) : 0;
  
  // Build detailed table for suggestions (properly formatted markdown)
  const tableRows = results
    .filter(r => r.status === 'success' && r.mentionsBrand)
    .map(result => {
      const sentimentBadge = result.classification === 'positive' ? '🟢 Positive' :
                             result.classification === 'negative' ? '🔴 Negative' : '🟡 Neutral';
      const mention = result.mentionsBrand ? `Yes (${result.mentionCount}x)` : 'No';
      const excerpt = result.excerpts && result.excerpts.length > 0 
        ? result.excerpts[0].substring(0, 150).replace(/\|/g, '\\|').replace(/\n/g, ' ') + '...' 
        : '-';
      
      return `| ${result.url} | ${sentimentBadge} | **${mention}** | ${result.rationale} | _"${excerpt}"_ |`;
    })
    .join('\n');
  
  const suggestionValue = `## Top ${summary.withMentions} Referring Domains\n\n| Referring Domain | Sentiment Analysis | Brand Mention | Rationale | Excerpt |\n|-----|-----------|---------------|-----------|---------|\n${tableRows}`;
  
  return {
    opportunity: {
      id: `opp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      siteId: `site-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      runbook: "https://adobe.sharepoint.com/sites/backlink-sentiment-analysis",
      type: "generic-opportunity",
      data: {
        dataSources: ["Ahrefs"]
      },
      origin: "ESS_OPS",
      title: "Backlink Sentiment Analysis",
      description: `This audit analyzes sentiment around brand mentions across backlink sources to assess brand perception and content quality. Using context-aware sentiment analysis, we evaluated ${summary.successful} referring domains to identify how ${searchTerm} is portrayed in external content, highlighting opportunities and potential reputation risks.`,
      guidance: {
        recommendations: [
          {
            insight: `Overall Brand Health: ${positivePercent > 70 ? 'Very good' : positivePercent > 40 ? 'Good' : positivePercent > 10 ? 'Fair' : 'Limited'} (${positivePercent}% positive sentiment, ${avgScore.toFixed(2)} avg score).`,
            recommendation: null,
            type: null,
            rationale: negative > 0 
              ? `${negative} pages show negative brand perception. ${neutral} neutral pages present opportunity for enhancement.`
              : positive > 0
                ? `${positive} positive mentions with ${neutral} neutral pages presenting enhancement opportunities.`
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
              ? `Address ${negative} negative page${negative > 1 ? 's' : ''} immediately to improve brand perception.`
              : `Monitor ${neutral} neutral pages for enhancement opportunities.`,
            type: null,
            rationale: null
          },
          {
            insight: null,
            recommendation: `${positive > 0 ? `Leverage ${positive} positive mention${positive > 1 ? 's' : ''} in marketing materials.` : ''} ${summary.successful - summary.withMentions > 0 ? `Outreach to ${summary.successful - summary.withMentions} non-mentioning sites to add ${searchTerm} brand presence.` : ''}`,
            type: null,
            rationale: null
          }
        ]
      },
      tags: ["Off-Site", "isElmo", "llm", "context-aware-sentiment"],
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
      
      // Generate improvement suggestions
      result.suggestions = generateImprovementSuggestions(result.sentiment, result.classification, url, result.excerpts);
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
    const filteredUrls = candidateUrls.filter(url => !isStockFinancePage(url));
    const skippedStock = candidateUrls.length - filteredUrls.length;
    
    if (skippedStock > 0) {
      console.log(`ℹ️  Skipped ${skippedStock} stock/finance pages (not real brand content)`);
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

    // Generate JSON report in opportunity schema format
    const jsonPath = CONFIG.outputHTML.replace('.html', '.json');
    const opportunityData = generateOpportunityJSON(reportData);
    fs.writeFileSync(jsonPath, JSON.stringify(opportunityData, null, 2), 'utf8');
    console.log(`✓ JSON report saved to: ${jsonPath}`);

    // Generate HTML report
    generateHTMLReport(reportData, CONFIG.outputHTML);
    console.log(`✓ HTML report saved to: ${CONFIG.outputHTML}`);

    // Generate Markdown report
    const markdownPath = CONFIG.outputHTML.replace('.html', '.md');
    generateMarkdownReport(reportData, markdownPath);
    console.log(`✓ Markdown report saved to: ${markdownPath}`);
    console.log();

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the analyzer
main();

