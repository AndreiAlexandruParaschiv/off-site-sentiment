const fs = require('fs');

function generateHTMLReport(data, outputPath) {
  const { searchTerm, timestamp, results, summary } = data;
  
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
  
  // Generate HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sentiment Analysis Report - ${searchTerm}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            border-radius: 8px;
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        
        .header p {
            font-size: 1.1em;
            opacity: 0.9;
        }
        
        .summary {
            padding: 40px;
            background: #f9fafb;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border-left: 4px solid #667eea;
        }
        
        .stat-card h3 {
            font-size: 0.9em;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 8px;
        }
        
        .stat-card .value {
            font-size: 2em;
            font-weight: bold;
            color: #1f2937;
        }
        
        .sentiment-bars {
            margin-top: 30px;
        }
        
        .sentiment-bars h3 {
            margin-bottom: 15px;
            color: #1f2937;
        }
        
        .bar-item {
            margin-bottom: 15px;
        }
        
        .bar-label {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
            font-size: 0.9em;
        }
        
        .bar-container {
            background: #e5e7eb;
            height: 30px;
            border-radius: 15px;
            overflow: hidden;
        }
        
        .bar-fill {
            height: 100%;
            display: flex;
            align-items: center;
            padding-left: 15px;
            color: white;
            font-weight: bold;
            transition: width 0.3s ease;
        }
        
        .bar-fill.positive {
            background: linear-gradient(90deg, #10b981, #059669);
        }
        
        .bar-fill.neutral {
            background: linear-gradient(90deg, #6b7280, #4b5563);
        }
        
        .bar-fill.negative {
            background: linear-gradient(90deg, #ef4444, #dc2626);
        }
        
        .results {
            padding: 40px;
        }
        
        .results h2 {
            margin-bottom: 20px;
            color: #1f2937;
        }
        
        .results-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            font-size: 0.9em;
        }
        
        .results-table th {
            background: #f3f4f6;
            padding: 12px;
            text-align: left;
            font-weight: 600;
            color: #374151;
            border-bottom: 2px solid #e5e7eb;
        }
        
        .results-table td {
            padding: 12px;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .results-table tr:hover {
            background: #f9fafb;
        }
        
        .url-cell {
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .url-cell a {
            color: #667eea;
            text-decoration: none;
        }
        
        .url-cell a:hover {
            text-decoration: underline;
        }
        
        .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.85em;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .badge.positive {
            background: #d1fae5;
            color: #065f46;
        }
        
        .badge.neutral {
            background: #e5e7eb;
            color: #374151;
        }
        
        .badge.negative {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .badge.error {
            background: #fef3c7;
            color: #92400e;
        }
        
        .badge.success {
            background: #dbeafe;
            color: #1e40af;
        }
        
        .excerpt {
            font-size: 0.85em;
            color: #6b7280;
            font-style: italic;
            margin-top: 5px;
            line-height: 1.4;
        }
        
        .highlight {
            background: #fef3c7;
            padding: 2px 4px;
            border-radius: 2px;
            font-weight: 600;
            color: #92400e;
        }
        
        .footer {
            padding: 20px 40px;
            background: #f9fafb;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 0.9em;
        }
        
        .error-message {
            color: #dc2626;
            font-size: 0.85em;
        }
        
        .score-value {
            font-weight: 600;
        }
        
        .score-value.positive {
            color: #059669;
        }
        
        .score-value.negative {
            color: #dc2626;
        }
        
        .score-value.neutral {
            color: #6b7280;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Backlink Sentiment Analysis Report</h1>
            <p>Brand: <strong>${searchTerm}</strong></p>
            <p>Generated: ${new Date(timestamp).toLocaleString()}</p>
        </div>
        
        <div class="summary">
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>Total URLs</h3>
                    <div class="value">${summary.total}</div>
                </div>
                <div class="stat-card">
                    <h3>Successfully Analyzed</h3>
                    <div class="value">${summary.successful}</div>
                </div>
                <div class="stat-card">
                    <h3>Brand Mentions</h3>
                    <div class="value">${summary.withMentions}</div>
                </div>
                <div class="stat-card">
                    <h3>Errors</h3>
                    <div class="value">${summary.errors}</div>
                </div>
                <div class="stat-card">
                    <h3>Average Score</h3>
                    <div class="value">${avgScore.toFixed(2)}</div>
                </div>
                <div class="stat-card">
                    <h3>Comparative Score</h3>
                    <div class="value">${avgComparative.toFixed(4)}</div>
                </div>
            </div>
            
            ${successful.length > 0 ? `
            <div class="sentiment-bars">
                <h3>Sentiment Distribution</h3>
                <div class="bar-item">
                    <div class="bar-label">
                        <span>Positive</span>
                        <span>${positive} URLs (${positivePercent}%)</span>
                    </div>
                    <div class="bar-container">
                        <div class="bar-fill positive" style="width: ${positivePercent}%">
                            ${positivePercent}%
                        </div>
                    </div>
                </div>
                <div class="bar-item">
                    <div class="bar-label">
                        <span>Neutral</span>
                        <span>${neutral} URLs (${neutralPercent}%)</span>
                    </div>
                    <div class="bar-container">
                        <div class="bar-fill neutral" style="width: ${neutralPercent}%">
                            ${neutralPercent}%
                        </div>
                    </div>
                </div>
                <div class="bar-item">
                    <div class="bar-label">
                        <span>Negative</span>
                        <span>${negative} URLs (${negativePercent}%)</span>
                    </div>
                    <div class="bar-container">
                        <div class="bar-fill negative" style="width: ${negativePercent}%">
                            ${negativePercent}%
                        </div>
                    </div>
                </div>
            </div>
            ` : ''}
        </div>
        
        <div class="results">
            <h2>Detailed Results</h2>
            <table class="results-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>URL</th>
                        <th>Status</th>
                        <th>Sentiment</th>
                        <th>Score</th>
                        <th>Brand Mention</th>
                        <th>Rationale</th>
                        <th>Excerpt</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.map((result, index) => `
                    <tr>
                        <td>${index + 1}</td>
                        <td class="url-cell">
                            <a href="${result.url}" target="_blank" title="${result.url}">${result.url}</a>
                        </td>
                        <td>
                            <span class="badge ${result.status}">${result.status}</span>
                        </td>
                        <td>
                            ${result.classification ? `<span class="badge ${result.classification}">${result.classification}</span>` : '-'}
                        </td>
                        <td>
                            ${result.sentiment ? `<span class="score-value ${result.classification}">${result.sentiment.score}</span>` : '-'}
                        </td>
                        <td>
                            ${result.mentionsBrand ? '✓ Yes' : '✗ No'}
                        </td>
                        <td style="font-size: 0.85em; max-width: 400px;">
                            ${result.rationale || '-'}
                        </td>
                        <td>
                            ${result.excerpts && result.excerpts.length > 0 
                                ? `<div class="excerpt">"...${result.excerpts[0].replace(new RegExp(searchTerm, 'gi'), match => `<span class="highlight">${match}</span>`)}..."</div>`
                                : result.error 
                                    ? `<div class="error-message">${result.error}</div>`
                                    : '-'
                            }
                        </td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="footer">
            <p>Generated by Backlink Sentiment Analyzer</p>
            <p>Sentiment analysis powered by the Sentiment library</p>
        </div>
    </div>
</body>
</html>`;
  
  // Write to file
  fs.writeFileSync(outputPath, html, 'utf8');
}

module.exports = { generateHTMLReport };

