# Backlink Sentiment Analyzer

Analyze brand sentiment from Ahrefs backlink exports with one simple command.

## Quick Start

### 1. Add Your CSV

Put your Ahrefs CSV export in the `backlinks` folder:

```
backlinks/
  └── CambriaUSA Backlinks.csv
```

### 2. Run Analysis

```bash
npm run analyze
```

**Done!** The report opens automatically in your browser.

## Installation

First time only:

```bash
npm install
```

## How It Works

1. **Parses Ahrefs CSV** - Extracts URLs, handles UTF-16 encoding, removes duplicates
2. **Fetches Pages** - Gets content from each backlink URL
3. **Analyzes Sentiment** - Detects brand mentions and calculates sentiment scores
4. **Generates Report** - Creates HTML report with detailed rationale
5. **Opens Report** - Automatically opens in browser

## Output

Reports are saved in the `reports` folder with timestamp:

```
reports/
  └── CambriaUSA Backlinks-report-2025-10-15.html
```

## Report Features

- **Overall Sentiment Summary** - Average scores, positive/neutral/negative distribution
- **Visual Charts** - Sentiment distribution bars
- **Detailed Table** for each URL:
  - Sentiment score & classification
  - **Rationale** - Explains why (e.g., "8 positive words: stunning, beautiful, best...")
  - Brand mention detection
  - Text excerpts with highlighted mentions
  - Error tracking

## Features

✅ Automatic URL deduplication  
✅ UTF-16 encoding support (Ahrefs format)  
✅ Brand mention detection  
✅ Sentiment rationale explanations  
✅ Error handling (failed URLs don't stop analysis)  
✅ Rate limiting (1-second delays between requests)  

## Folder Structure

```
off-site-sentiment/
├── src/                    ← All source code
│   ├── analyze.js              → Main entry point
│   ├── sentiment-analyzer.js   → Sentiment analysis engine
│   ├── report-generator.js     → HTML report generator
│   └── parse-ahrefs-csv.js     → Ahrefs CSV parser
│
├── backlinks/              ← Put your CSV files here
├── reports/                ← HTML reports saved here
├── .temp/                  ← Temporary files (auto-managed)
│
├── README.md               ← This guide
└── package.json            ← Dependencies & config
```

## Analyze Different Brand

To analyze a different brand, edit `src/sentiment-analyzer.js` line 11:

```javascript
searchTerm: 'YourBrand',  // Change from 'Cambria'
```

## Multiple CSV Files

**If you have multiple CSV files:**

The analyzer automatically uses the **first file** (alphabetically) unless you specify which one.

**Option 1: Let it auto-select** (uses first file alphabetically)
```bash
npm run analyze
```

**Option 2: Specify which file** (if you want a specific one)
```bash
npm run analyze "CambriaUSA Backlinks Oct 2025.csv"
```

**Example:**
```
backlinks/
  ├── CambriaUSA Backlinks Nov 2025.csv  ← Will auto-select this (alphabetically first)
  └── CambriaUSA Backlinks Oct 2025.csv

# Auto-select (uses Nov file)
$ npm run analyze

# Or specify the Oct file
$ npm run analyze "CambriaUSA Backlinks Oct 2025.csv"
```

**Pro tip:** Delete old CSV files you don't need, then you can just run `npm run analyze` without thinking about it.

## Troubleshooting

**"No CSV files found"**
- Ensure your CSV file is in the `backlinks` folder

**"Failed to fetch" errors**
- Some websites block automated requests
- These URLs are marked as errors in the report
- Analysis continues with remaining URLs

**Low sentiment scores**
- Check the rationale column to understand why
- Neutral scores are normal for factual content
- Review text excerpts to verify accuracy

## Requirements

- Node.js (v14 or higher)
- Internet connection (to fetch URLs)

## Dependencies

- `axios` - HTTP client for fetching pages
- `cheerio` - HTML parsing and text extraction
- `csv-parser` - CSV file parsing
- `sentiment` - Sentiment analysis library
- `iconv-lite` - Character encoding conversion

## License

MIT
