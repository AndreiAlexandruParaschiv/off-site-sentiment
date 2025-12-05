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
  const sentimentEmoji = overallSentiment === 'positive' ? '🟢' : overallSentiment === 'negative' ? '🔴' : '🟡';
  
  // Calculate brand health score (0-100)
  const brandHealthScore = Math.min(100, Math.max(0, 
    50 + (avgScore * 5) + (positive * 3) - (negative * 5) + (summary.withMentions / summary.successful * 20)
  )).toFixed(0);
  
  let markdown = `# Backlink Sentiment Analysis Report

**Brand:** ${searchTerm}  
**Generated:** ${new Date(timestamp).toLocaleString()}

---

## 📊 Executive Summary

This report analyzes the **top ${results.length} backlink URLs** pointing to ${searchTerm}'s website to assess brand perception across external content. By examining how ${searchTerm} is mentioned and portrayed on referring domains, we identify reputation risks and opportunities for brand enhancement.

### Brand Health Score: ${brandHealthScore}/100 ${sentimentEmoji}

| Metric | Value |
|--------|-------|
| **Overall Sentiment** | ${overallSentiment.charAt(0).toUpperCase() + overallSentiment.slice(1)} (${avgScore.toFixed(2)}) |
| **Favorable Mentions** | ${positive} (${positivePercent}%) |
| **Neutral Mentions** | ${neutral} (${neutralPercent}%) |
| **Unfavorable Mentions** | ${negative} (${negativePercent}%) |
| **Brand Visibility** | ${summary.withMentions} of ${summary.successful} pages mention ${searchTerm} |

---

## 🎯 Priority Action Items

${generateActionItems(positive, neutral, negative, summary, searchTerm, insights)}

---

## 🔍 Key Insights

${insights ? generateInsightsMarkdown(insights, searchTerm, summary, positive, neutral, negative) : ''}

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

| URL | Sentiment | Brand Mention | Rationale | AI Recommendation |
|-----|-----------|---------------|-----------|-------------------|
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
    
    // Format AI recommendation based on sentiment
    let aiRecommendation = '-';
    if (result.suggestions && result.suggestions.length > 0) {
      // Format all suggestions as a compact recommendation
      aiRecommendation = result.suggestions.map(s => escapeMarkdown(s)).join(' ');
    }
    
    markdown += `| ${url} | ${sentiment} | ${brandMention} | ${rationale} | ${aiRecommendation} |\n`;
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

// Helper function to generate priority action items
function generateActionItems(positive, neutral, negative, summary, searchTerm, insights) {
  let markdown = '';
  let priority = 1;
  
  // High priority: Address negative mentions
  if (negative > 0) {
    markdown += `### 🔴 HIGH PRIORITY\n\n`;
    markdown += `${priority}. **Address ${negative} Unfavorable Mention${negative > 1 ? 's' : ''}**\n`;
    markdown += `   - Review negative content and identify specific concerns\n`;
    markdown += `   - Prepare response strategy or request corrections from content owners\n`;
    markdown += `   - Monitor these pages for sentiment changes\n\n`;
    priority++;
  }
  
  // Medium priority: Enhance neutral mentions
  if (neutral > 0) {
    markdown += `### 🟡 MEDIUM PRIORITY\n\n`;
    markdown += `${priority}. **Enhance ${neutral} Neutral Mention${neutral > 1 ? 's' : ''}**\n`;
    markdown += `   - Reach out to content owners with compelling brand stories\n`;
    markdown += `   - Provide case studies, testimonials, or updated product information\n`;
    markdown += `   - Offer exclusive content or quotes to improve brand portrayal\n\n`;
    priority++;
  }
  
  // Low priority: Leverage positive mentions
  if (positive > 0) {
    markdown += `### 🟢 OPPORTUNITY\n\n`;
    markdown += `${priority}. **Leverage ${positive} Favorable Mention${positive > 1 ? 's' : ''}**\n`;
    markdown += `   - Use positive coverage in marketing materials and social proof\n`;
    markdown += `   - Build relationships with these content creators for future collaboration\n`;
    markdown += `   - Share and amplify positive content on social media\n\n`;
    priority++;
  }
  
  // Visibility improvement
  const nonMentioning = summary.successful - summary.withMentions;
  if (nonMentioning > 0) {
    markdown += `### 📈 VISIBILITY IMPROVEMENT\n\n`;
    markdown += `${priority}. **Increase Brand Presence on ${nonMentioning} Non-Mentioning Page${nonMentioning > 1 ? 's' : ''}**\n`;
    markdown += `   - These referring pages link to ${searchTerm} but don't mention the brand by name\n`;
    markdown += `   - Contact site owners to add brand mentions with anchor text\n`;
    markdown += `   - This can improve both SEO and brand awareness\n\n`;
  }
  
  return markdown;
}

// Helper function to generate concise insights markdown
function generateInsightsMarkdown(insights, searchTerm, summary, positive, neutral, negative) {
  const topDomain = insights.topDomains && insights.topDomains.length > 0 ? insights.topDomains[0] : null;
  const mentionRate = ((insights.pagesWithMentions / insights.successfulPages) * 100).toFixed(1);
  
  let markdown = '### Backlink Profile Analysis\n\n';
  
  if (topDomain) {
    markdown += `- **Top Referring Domain:** ${topDomain.domain} with ${topDomain.count} brand mentions\n`;
  }
  
  markdown += `- **Brand Visibility Rate:** ${mentionRate}% of backlink pages actively mention ${searchTerm}\n`;
  markdown += `- **High-Impact Pages:** ${insights.highMentionPages} pages with 3+ brand mentions`;
  if (insights.highMentionPages > 0) {
    markdown += ` (${insights.highMentionSentiment.positive} favorable, ${insights.highMentionSentiment.negative} unfavorable)`;
  }
  markdown += `\n`;
  
  // Sentiment health assessment
  markdown += `\n### Sentiment Assessment\n\n`;
  
  if (negative === 0 && positive > 0) {
    markdown += `✅ **Excellent:** No negative brand mentions detected. ${positive} favorable mention${positive > 1 ? 's' : ''} strengthen${positive === 1 ? 's' : ''} brand perception.\n`;
  } else if (negative === 0 && positive === 0) {
    markdown += `⚠️ **Neutral:** All mentions are factual/informational. Opportunity to enhance brand advocacy.\n`;
  } else if (negative > 0 && negative <= positive) {
    markdown += `⚠️ **Mixed:** ${negative} negative mention${negative > 1 ? 's' : ''} detected but outweighed by ${positive} positive. Address concerns while leveraging positives.\n`;
  } else if (negative > 0) {
    markdown += `🚨 **Attention Required:** ${negative} negative mention${negative > 1 ? 's' : ''} detected. Prioritize reputation management.\n`;
  }
  
  // Top domains breakdown
  if (insights.topDomains && insights.topDomains.length > 1) {
    markdown += `\n### Top Referring Domains by Brand Mentions\n\n`;
    markdown += `| Domain | Mentions | Sentiment |\n`;
    markdown += `|--------|----------|----------|\n`;
    insights.topDomains.slice(0, 5).forEach(domain => {
      const sentimentInfo = domain.sentiment || {};
      const sentimentLabel = sentimentInfo.positive > 0 ? '🟢 Favorable' : 
                            sentimentInfo.negative > 0 ? '🔴 Unfavorable' : '🟡 Neutral';
      markdown += `| ${domain.domain} | ${domain.count} | ${sentimentLabel} |\n`;
    });
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

