const fs = require('fs');
const iconv = require('iconv-lite');

// Read and convert the Ahrefs CSV file
const inputFile = process.argv[2] || 'backlinks.csv';
const outputFile = process.argv[3] || 'parsed-urls.csv';

console.log(`Reading: ${inputFile}`);

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

// Find the URL column (should be "Referring page URL")
const headerLine = lines[0];
const headers = headerLine.split('\t');
const urlColumnIndex = headers.findIndex(h => 
  h.includes('Referring page URL') || h.includes('URL')
);

console.log(`Found URL column at index: ${urlColumnIndex}`);

// Extract URLs
const urls = [];
const seenUrls = new Set();

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  
  const columns = lines[i].split('\t');
  if (columns.length > urlColumnIndex) {
    let url = columns[urlColumnIndex].trim();
    // Remove quotes if present
    url = url.replace(/^"/, '').replace(/"$/, '');
    
    if (url && url.startsWith('http') && !seenUrls.has(url)) {
      seenUrls.add(url);
      urls.push(url);
    }
  }
}

console.log(`Extracted ${urls.length} unique URLs`);

// Write to output CSV
const outputContent = 'url\n' + urls.join('\n');
fs.writeFileSync(outputFile, outputContent, 'utf8');

console.log(`✓ Saved to: ${outputFile}`);

