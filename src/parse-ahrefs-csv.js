const fs = require('fs');
const iconv = require('iconv-lite');

// Read and convert the Ahrefs CSV file
const inputFile = process.argv[2] || 'backlinks.csv';
const outputFile = process.argv[3] || 'parsed-urls.csv';
const englishOnly = process.argv[4] === 'true'; // Optional: filter for English-only URLs

console.log(`Reading: ${inputFile}`);
if (englishOnly) {
  console.log(`Filter: English language only`);
}

// Read the file as a buffer
const buffer = fs.readFileSync(inputFile);

// Try to detect and convert from UTF-16LE
let content;
try {
  content = iconv.decode(buffer, 'utf16le');
} catch (e) {
  console.log('UTF-16LE failed, trying UTF-8');
  content = buffer.toString('utf8');
}

// Split into lines
const lines = content.split(/\r?\n/);

// Find the URL and Language columns
const headerLine = lines[0];
const headers = headerLine.split('\t');
const urlColumnIndex = headers.findIndex(h => 
  h.includes('Referring page URL') || h.includes('URL')
);
const languageColumnIndex = headers.findIndex(h => 
  h.includes('Language')
);

console.log(`Found URL column at index: ${urlColumnIndex}`);
if (englishOnly && languageColumnIndex >= 0) {
  console.log(`Found Language column at index: ${languageColumnIndex}`);
}

// Extract URLs
const urls = [];
const seenUrls = new Set();
let filteredCount = 0;

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  
  const columns = lines[i].split('\t');
  if (columns.length > urlColumnIndex) {
    let url = columns[urlColumnIndex].trim();
    // Remove quotes if present
    url = url.replace(/^"/, '').replace(/"$/, '');
    
    // Check language filter if enabled
    if (englishOnly && languageColumnIndex >= 0) {
      const language = columns[languageColumnIndex]?.trim().replace(/^"/, '').replace(/"$/, '') || '';
      // Only include if language is "en" or starts with "en"
      if (!language.startsWith('en') && language !== 'en') {
        filteredCount++;
        continue;
      }
    }
    
    if (url && url.startsWith('http') && !seenUrls.has(url)) {
      seenUrls.add(url);
      urls.push(url);
    }
  }
}

if (englishOnly && filteredCount > 0) {
  console.log(`Filtered out ${filteredCount} non-English URLs`);
}

console.log(`Extracted ${urls.length} unique URLs`);

// Write to output CSV
const outputContent = 'url\n' + urls.join('\n');
fs.writeFileSync(outputFile, outputContent, 'utf8');

console.log(`✓ Saved to: ${outputFile}`);

