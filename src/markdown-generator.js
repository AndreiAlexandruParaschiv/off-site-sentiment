const fs = require('fs');

function generateMarkdownReport(data, outputPath) {
  const { searchTerm, timestamp, results, summary, insights } = data;
  
  // Calculate statistics
  const successful = results.filter(r => r.status === 'success' && r.sentiment);
  
  let avgScore = 0;
  let avgComparative = 0;
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  
  if (successful.length > 0) {
    avgScore = successful.reduce((sum, r) => sum + r.sentiment.score, 0) / successful.length;
    avgComparative = successful.reduce((sum, r) => sum + r.sentiment.comparative, 0) / successful.length;
    positive = successful.filter(r => r.classification === 'positive').length;
    negative = successful.filter(r => r.classification === 'negative').length;
    neutral = successful.filter(r => r.classification === 'neutral').length;
  }
  
  const positivePercent = successful.length > 0 ? (positive / successful.length * 100).toFixed(1) : 0;
  const neutralPercent = successful.length > 0 ? (neutral / successful.length * 100).toFixed(1) : 0;
  const negativePercent = successful.length > 0 ? (negative / successful.length * 100).toFixed(1) : 0;
  
  // Generate markdown content
  const overallSentiment = avgScore > 0 ? 'positive' : avgScore < 0 ? 'negative' : 'neutral';
  
  let markdown = `# Backlink Sentiment Analysis Report

**Brand:** ${searchTerm}  
**Generated:** ${new Date(timestamp).toLocaleString()}

---

## 📊 Overview

**${searchTerm}** analysis of ${results.length} pages shows **${overallSentiment}** sentiment (score: ${avgScore.toFixed(2)}). ${positive} positive (${positivePercent}%), ${neutral} neutral (${neutralPercent}%), ${negative} negative (${negativePercent}%). ${summary.withMentions} of ${summary.successful} pages mention the brand.

**Action:** ${negative > 0 ? `Address ${negative} negative page${negative > 1 ? 's' : ''} immediately.` : ''} ${neutral > 0 ? `Enhance ${neutral} neutral page${neutral > 1 ? 's' : ''}.` : ''} ${positive > 0 ? `Leverage ${positive} positive mention${positive > 1 ? 's' : ''}.` : ''}

---

## 🔍 Key Insights

${insights ? generateInsightsMarkdown(insights, searchTerm, summary) : ''}

---

## Summary Statistics

- **Total URLs Processed:** ${summary.total}
- **Successfully Analyzed:** ${summary.successful}
- **Pages with Brand Mentions:** ${summary.withMentions}
- **Errors:** ${summary.errors}
- **Average Sentiment Score:** ${avgScore.toFixed(2)}
- **Average Comparative Score:** ${avgComparative.toFixed(4)}

### Sentiment Distribution

- **Favorable:** ${positive} URLs (${positivePercent}%)
- **Neutral:** ${neutral} URLs (${neutralPercent}%)
- **Unfavorable:** ${negative} URLs (${negativePercent}%)

---

## Detailed Results

| URL | Sentiment | Brand Mention | Rationale | Improvement Suggestions | Excerpt |
|-----|-----------|---------------|-----------|------------------------|---------|
`;
  
  // Add each result as a table row (only include pages with brand mentions)
  results.forEach((result) => {
    // Skip error results and pages without brand mentions
    if (result.status === 'error' || !result.mentionsBrand) {
      return;
    }
    
    // Format URL as HTML link to open in new tab
    const url = `<a href="${result.url}" target="_blank">${escapeMarkdown(result.url)}</a>`;
    const sentiment = result.classification 
      ? (result.classification === 'negative' ? '🔴 Unfavorable' : result.classification === 'neutral' ? '🟡 Neutral' : '🟢 Favorable')
      : '-';
    
    // Brand mention with count
    let brandMention = 'No';
    if (result.mentionsBrand && result.mentionCount > 0) {
      brandMention = `Yes (${result.mentionCount}x)`;
    } else if (result.mentionsBrand) {
      brandMention = 'Yes';
    }
    
    const rationale = result.rationale ? escapeMarkdown(result.rationale) : '-';
    
    // Format suggestions
    let suggestions = '-';
    if (result.suggestions && result.suggestions.length > 0) {
      // Take first 3 suggestions for brevity in table
      const topSuggestions = result.suggestions.slice(0, 3);
      suggestions = topSuggestions.map(s => escapeMarkdown(s)).join('; ');
    }
    
    // For excerpt, show the longest/best context where brand is mentioned
    let excerpt = '-';
    if (result.excerpts && result.excerpts.length > 0) {
      // Find the longest excerpt (usually has the most context)
      const bestExcerpt = result.excerpts.reduce((longest, current) => 
        current.length > longest.length ? current : longest
      );
      // Clean it up and show brief context (up to 150 chars for table)
      const cleanExcerpt = escapeMarkdown(bestExcerpt.substring(0, 150).trim());
      excerpt = `_"${cleanExcerpt}${bestExcerpt.length > 150 ? '...' : ''}"_`;
    }
    
    markdown += `| ${url} | ${sentiment} | ${brandMention} | ${rationale} | ${suggestions} | ${excerpt} |\n`;
  });
  
  markdown += `\n---

## Legend

**Sentiment:**
- \`favorable\` - Favorable sentiment (score > 0)
- \`neutral\` - Neutral sentiment (score = 0)
- \`unfavorable\` - Unfavorable sentiment (score < 0)

---

*Report generated by Backlink Sentiment Analyzer*
`;
  
  // Write to file
  fs.writeFileSync(outputPath, markdown, 'utf8');
}

// Helper function to generate concise insights markdown
function generateInsightsMarkdown(insights, searchTerm, summary) {
  const topDomain = insights.topDomains && insights.topDomains.length > 0 ? insights.topDomains[0] : null;
  const mentionRate = ((insights.pagesWithMentions / insights.successfulPages) * 100).toFixed(1);
  
  let markdown = '';
  if (topDomain) {
    markdown += `- **Top Referrer:** ${topDomain.domain} (${topDomain.count} mentions)\n`;
  }
  markdown += `- **Visibility:** ${insights.pagesWithMentions} of ${insights.successfulPages} pages (${mentionRate}%) mention ${searchTerm}\n`;
  markdown += `- **High-Impact:** ${insights.highMentionPages} pages with 3+ mentions${insights.highMentionPages > 0 ? ` (${insights.highMentionSentiment.negative} negative, ${insights.highMentionSentiment.positive} positive)` : ''}\n`;
  
  const successful = summary.successful || 0;
  const negative = Math.round((summary.total - summary.successful) * 0.4); // Estimate from current data
  if (negative > 0) {
    markdown += `- **Action Required:** Monitor and address negative pages\n`;
  }
  
  return markdown;
}

// Helper function to escape markdown special characters
function escapeMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '')
    .trim();
}

// Helper function to truncate text
function truncate(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

module.exports = { generateMarkdownReport };

