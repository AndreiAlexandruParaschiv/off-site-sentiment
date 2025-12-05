#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Configuration
const BACKLINKS_FOLDER = 'backlinks';
const REPORTS_FOLDER = 'reports';
const TEMP_FOLDER = '.temp';

// Helper function to extract company name and folder name from CSV filename
function extractCompanyInfo(filename) {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.csv$/i, '');
  
  // Extract company name - handles formats like:
  // "Lilly.com Backlinks Subdomains Oct 30 2025 (1).csv" -> { name: "Lilly", folder: "Lilly" }
  // "CambriaUSA Backlinks.csv" -> { name: "Cambria", folder: "Cambria USA" }
  // "Daikin.co.uk - trending URLs Citations.csv" -> { name: "Daikin", folder: "Daikin.co.uk" }
  
  // Try to find domain pattern including .co.uk (e.g., "Daikin.co.uk")
  const domainWithCountryMatch = nameWithoutExt.match(/^([a-zA-Z0-9-]+)(\.co\.[a-z]{2,3})/i);
  if (domainWithCountryMatch) {
    return {
      name: domainWithCountryMatch[1], // Just the company name for search
      folder: domainWithCountryMatch[1] + domainWithCountryMatch[2] // Full domain for folder
    };
  }
  
  // Try to find domain pattern (e.g., "Lilly.com")
  const domainMatch = nameWithoutExt.match(/^([a-zA-Z0-9-]+)\.(com|net|org|edu|gov)/i);
  if (domainMatch) {
    return {
      name: domainMatch[1],
      folder: domainMatch[1]
    };
  }
  
  // Try to extract company name before "Backlinks"
  const backlinkMatch = nameWithoutExt.match(/^([a-zA-Z0-9-]+)\s*Backlinks/i);
  if (backlinkMatch) {
    // Remove "USA" suffix if present
    const name = backlinkMatch[1].replace(/USA$/i, '');
    return {
      name: name,
      folder: backlinkMatch[1]
    };
  }
  
  // Fallback: use first word
  const firstWord = nameWithoutExt.split(/[\s_-]/)[0];
  return {
    name: firstWord,
    folder: firstWord
  };
}

console.log('='.repeat(60));
console.log('Backlink Sentiment Analyzer');
console.log('='.repeat(60));
console.log();

// Check if backlinks folder exists
if (!fs.existsSync(BACKLINKS_FOLDER)) {
  console.error(`❌ Error: "${BACKLINKS_FOLDER}" folder not found`);
  console.log(`\nPlease create a "${BACKLINKS_FOLDER}" folder and add your Ahrefs CSV file.`);
  process.exit(1);
}

// Find CSV files in backlinks folder
const files = fs.readdirSync(BACKLINKS_FOLDER).filter(f => f.endsWith('.csv'));

if (files.length === 0) {
  console.error(`❌ Error: No CSV files found in "${BACKLINKS_FOLDER}" folder`);
  console.log('\nPlease add your Ahrefs CSV export to the backlinks folder.');
  process.exit(1);
}

// Filter out flags from arguments to find the filename
const fileArg = process.argv.slice(2).find(arg => !arg.startsWith('--'));

// Use the first CSV file or the one specified
const inputFile = fileArg || files[0];
const inputPath = path.join(BACKLINKS_FOLDER, inputFile);

if (!fs.existsSync(inputPath)) {
  console.error(`❌ Error: File "${inputFile}" not found in backlinks folder`);
  process.exit(1);
}

// Extract company info from filename
const companyInfo = extractCompanyInfo(inputFile);
const companyName = companyInfo.name; // Used for sentiment search
const folderName = companyInfo.folder; // Used for folder naming

// Check for --english-only flag
const englishOnly = process.argv.includes('--english-only');

// Check for --max-urls=N flag
const maxUrlsArg = process.argv.find(arg => arg.startsWith('--max-urls='));
const maxUrls = maxUrlsArg ? parseInt(maxUrlsArg.split('=')[1]) : null;

console.log(`📁 Input file: ${inputFile}`);
console.log(`🏢 Company name: ${companyName} (search term)`);
console.log(`📁 Folder name: ${folderName}`);
if (englishOnly) {
  console.log(`🌐 Language filter: English only`);
}
if (maxUrls) {
  console.log(`📊 Max URLs: ${maxUrls}`);
}

// Create temp folder if it doesn't exist
if (!fs.existsSync(TEMP_FOLDER)) {
  fs.mkdirSync(TEMP_FOLDER);
}

// Create reports folder if it doesn't exist
if (!fs.existsSync(REPORTS_FOLDER)) {
  fs.mkdirSync(REPORTS_FOLDER);
}

// Create company-specific folder within reports
const companyFolder = path.join(REPORTS_FOLDER, folderName);
if (!fs.existsSync(companyFolder)) {
  fs.mkdirSync(companyFolder, { recursive: true });
}

// Generate output filenames with timestamp
const baseName = path.basename(inputFile, '.csv');
const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
const timeStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // YYYY-MM-DDTHH-MM-SS
const cleanUrlsFile = path.join(TEMP_FOLDER, `${baseName}-urls.csv`);
const reportFile = path.join(companyFolder, `${folderName.replace(/\s+/g, '-')}-report-${timeStamp}.html`);

console.log(`📁 Company folder: ${companyFolder}`);
console.log(`📊 Output report: ${reportFile}`);
console.log();

try {
  // Step 1: Parse the Ahrefs CSV
  console.log('Step 1: Parsing Ahrefs CSV...');
  execSync(`node "${path.join(__dirname, 'parse-ahrefs-csv.js')}" "${inputPath}" "${cleanUrlsFile}" "${englishOnly}"`, { 
    stdio: 'inherit' 
  });
  console.log();

  // Step 2: Run sentiment analysis
  console.log('Step 2: Running sentiment analysis...');
  const maxUrlsParam = maxUrls ? ` "${maxUrls}"` : '';
  execSync(`node "${path.join(__dirname, 'sentiment-analyzer.js')}" "${cleanUrlsFile}" "${reportFile}" "${companyName}"${maxUrlsParam}`, { 
    stdio: 'inherit' 
  });
  console.log();

  // Success!
  console.log('='.repeat(60));
  console.log('✅ Analysis Complete!');
  console.log('='.repeat(60));
  console.log();
  console.log(`📊 Report saved to: ${reportFile}`);
  console.log();
  console.log('To view the report:');
  console.log(`   open "${reportFile}"`);
  console.log();

  // Open the report automatically
  try {
    execSync(`open "${reportFile}"`);
  } catch (e) {
    // Ignore if open command fails
  }

} catch (error) {
  console.error('\n❌ Error during analysis:', error.message);
  process.exit(1);
}

