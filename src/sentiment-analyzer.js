const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const Sentiment = require('sentiment');
const { generateHTMLReport } = require('./report-generator');

// Configuration
const CONFIG = {
  inputCSV: process.argv[2] || 'sample-urls.csv',
  outputHTML: process.argv[3] || 'sentiment-report.html',
  searchTerm: 'Cambria',
  requestTimeout: 10000, // 10 seconds
  delayBetweenRequests: 1000, // 1 second delay between requests
  requireMention: false, // Set to true to only analyze pages mentioning the brand
};

// Initialize sentiment analyzer
const sentiment = new Sentiment();

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

// Extract excerpts containing the search term
function extractExcerpts(text, searchTerm, contextLength = 150) {
  const regex = new RegExp(`(.{0,${contextLength}}${searchTerm}.{0,${contextLength}})`, 'gi');
  const matches = [];
  let match;
  
  while ((match = regex.exec(text)) !== null && matches.length < 3) {
    matches.push(match[1].trim());
  }
  
  return matches;
}

// Analyze sentiment of text
function analyzeSentiment(text) {
  const result = sentiment.analyze(text);
  
  return {
    score: result.score,
    comparative: result.comparative,
    positive: result.positive,
    negative: result.negative,
    positiveCount: result.positive.length,
    negativeCount: result.negative.length,
  };
}

// Classify sentiment based on score
function classifySentiment(score) {
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

// Generate rationale for sentiment based on analysis results
function generateSentimentRationale(sentimentResult, classification, text) {
  if (!sentimentResult) return '';
  
  const { score, positive, negative, positiveCount, negativeCount } = sentimentResult;
  
  if (classification === 'positive') {
    const reasons = [];
    if (positiveCount > 0) {
      reasons.push(`${positiveCount} positive word${positiveCount > 1 ? 's' : ''} detected (${positive.slice(0, 3).join(', ')}${positive.length > 3 ? ', etc.' : ''})`);
    }
    if (negativeCount > 0) {
      reasons.push(`only ${negativeCount} negative word${negativeCount > 1 ? 's' : ''}`);
    }
    return `Positive sentiment (score: +${score}): ${reasons.join('; ')}. The content presents the brand favorably.`;
  }
  
  if (classification === 'negative') {
    const reasons = [];
    if (negativeCount > 0) {
      reasons.push(`${negativeCount} negative word${negativeCount > 1 ? 's' : ''} detected (${negative.slice(0, 3).join(', ')}${negative.length > 3 ? ', etc.' : ''})`);
    }
    if (positiveCount > 0) {
      reasons.push(`only ${positiveCount} positive word${positiveCount > 1 ? 's' : ''}`);
    }
    return `Negative sentiment (score: ${score}): ${reasons.join('; ')}. The content may contain criticism or unfavorable mentions.`;
  }
  
  // Neutral
  return `Neutral sentiment (score: ${score}): Balanced content with ${positiveCount} positive and ${negativeCount} negative words. The article appears factual and objective.`;
}

// Process a single URL
async function processURL(url, index, total) {
  console.log(`[${index + 1}/${total}] Processing: ${url}`);
  
  const result = {
    url,
    status: 'success',
    error: null,
    mentionsBrand: false,
    textLength: 0,
    excerpts: [],
    sentiment: null,
    classification: null,
    rationale: '',
  };
  
  try {
    // Fetch page content
    const html = await fetchPageContent(url);
    
    // Extract text
    const text = extractTextContent(html);
    result.textLength = text.length;
    
    // Check for brand mentions
    result.mentionsBrand = mentionsSearchTerm(text, CONFIG.searchTerm);
    
    if (result.mentionsBrand) {
      result.excerpts = extractExcerpts(text, CONFIG.searchTerm);
    }
    
    // Analyze sentiment
    if (!CONFIG.requireMention || result.mentionsBrand) {
      result.sentiment = analyzeSentiment(text);
      result.classification = classifySentiment(result.sentiment.score);
      result.rationale = generateSentimentRationale(result.sentiment, result.classification, text);
    } else {
      result.status = 'skipped';
      result.error = `No mention of "${CONFIG.searchTerm}" found`;
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
    const urls = await readURLsFromCSV(CONFIG.inputCSV);
    
    if (urls.length === 0) {
      console.error('Error: No URLs found in CSV file');
      process.exit(1);
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
    console.log('Generating HTML report...');
    
    // Generate HTML report
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
    };
    
    generateHTMLReport(reportData, CONFIG.outputHTML);
    
    console.log(`✓ Report saved to: ${CONFIG.outputHTML}`);
    console.log();
    
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the analyzer
main();

