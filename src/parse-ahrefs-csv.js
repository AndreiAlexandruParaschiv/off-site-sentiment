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

// Detect encoding based on BOM or content analysis
let content;
let encoding = 'utf8';

// Check for BOM markers
if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
  // UTF-16LE BOM
  encoding = 'utf16le';
  content = iconv.decode(buffer, 'utf16le');
} else if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
  // UTF-16BE BOM
  encoding = 'utf16be';
  content = iconv.decode(buffer, 'utf16be');
} else if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
  // UTF-8 BOM
  encoding = 'utf8';
  content = buffer.toString('utf8').slice(1); // Remove BOM
} else {
  // No BOM - try to detect based on content
  // First try UTF-8 (most common)
  const utf8Content = buffer.toString('utf8');
  
  // Check if the content looks like valid text (has recognizable patterns)
  if (utf8Content.includes('"URL"') || utf8Content.includes('Referring page URL') || 
      utf8Content.includes('http://') || utf8Content.includes('https://')) {
    encoding = 'utf8';
    content = utf8Content;
  } else {
    // Try UTF-16LE as fallback (common for Ahrefs exports)
    try {
      const utf16Content = iconv.decode(buffer, 'utf16le');
      if (utf16Content.includes('URL') || utf16Content.includes('http')) {
        encoding = 'utf16le';
        content = utf16Content;
      } else {
        // Default to UTF-8
        encoding = 'utf8';
        content = utf8Content;
      }
    } catch (e) {
      encoding = 'utf8';
      content = utf8Content;
    }
  }
}

console.log(`Detected encoding: ${encoding}`);

// Remove BOM (Byte Order Mark) if still present
if (content.charCodeAt(0) === 0xFEFF) {
  content = content.slice(1);
}

// Split into lines
const lines = content.split(/\r?\n/);

// Detect delimiter (tab for Ahrefs, comma for standard CSV)
const headerLine = lines[0];
const isTabDelimited = headerLine.includes('\t');
const delimiter = isTabDelimited ? '\t' : ',';

// Simple CSV parser that handles quoted fields
function parseCSVLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      // Field separator
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current); // Add last field
  return result;
}

// Find the URL and Language columns
const parsedHeaders = parseCSVLine(headerLine, delimiter);
const headers = parsedHeaders.map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
const urlColumnIndex = headers.findIndex(h => 
  h.includes('Referring page URL') || h.includes('URL') || h === 'URL'
);
const languageColumnIndex = headers.findIndex(h => 
  h.includes('Language') || h === 'Language'
);

console.log(`Detected delimiter: ${isTabDelimited ? 'TAB' : 'COMMA'}`);
console.log(`Header line preview: ${headerLine.substring(0, 50)}...`);
console.log(`Parsed headers: ${JSON.stringify(headers)}`);
console.log(`Found URL column at index: ${urlColumnIndex} (${headers[urlColumnIndex] || 'N/A'})`);
if (englishOnly && languageColumnIndex >= 0) {
  console.log(`Found Language column at index: ${languageColumnIndex}`);
}

// Extract URLs
const urls = [];
const seenUrls = new Set();
let filteredCount = 0;

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  
  const columns = parseCSVLine(lines[i], delimiter);
  if (columns.length > urlColumnIndex && urlColumnIndex >= 0) {
    let url = columns[urlColumnIndex].trim();
    // Remove quotes if present
    url = url.replace(/^"/, '').replace(/"$/, '');
    
    // Check language filter if enabled
    if (englishOnly && languageColumnIndex >= 0 && columns.length > languageColumnIndex) {
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
