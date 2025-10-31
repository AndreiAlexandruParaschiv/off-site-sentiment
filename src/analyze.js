#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Configuration
const BACKLINKS_FOLDER = 'backlinks';
const REPORTS_FOLDER = 'reports';
const TEMP_FOLDER = '.temp';

// Helper function to extract company name from CSV filename
function extractCompanyName(filename) {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.csv$/i, '');
  
  // Extract company name - handles formats like:
  // "Lilly.com Backlinks Subdomains Oct 30 2025 (1).csv" -> "Lilly"
  // "CambriaUSA Backlinks.csv" -> "Cambria"
  
  // Try to find domain pattern (e.g., "Lilly.com")
  const domainMatch = nameWithoutExt.match(/^([a-zA-Z0-9-]+)\.(com|net|org|edu|gov)/i);
  if (domainMatch) {
    return domainMatch[1];
  }
  
  // Try to extract company name before "Backlinks"
  const backlinkMatch = nameWithoutExt.match(/^([a-zA-Z0-9-]+)\s*Backlinks/i);
  if (backlinkMatch) {
    // Remove "USA" suffix if present
    return backlinkMatch[1].replace(/USA$/i, '');
  }
  
  // Fallback: use first word
  const firstWord = nameWithoutExt.split(/[\s_-]/)[0];
  return firstWord;
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

// Extract company name from filename
const companyName = extractCompanyName(inputFile);

// Check for --english-only flag
const englishOnly = process.argv.includes('--english-only');

console.log(`📁 Input file: ${inputFile}`);
console.log(`🏢 Company name: ${companyName}`);
if (englishOnly) {
  console.log(`🌐 Language filter: English only`);
}

// Create temp folder if it doesn't exist
if (!fs.existsSync(TEMP_FOLDER)) {
  fs.mkdirSync(TEMP_FOLDER);
}

// Create reports folder if it doesn't exist
if (!fs.existsSync(REPORTS_FOLDER)) {
  fs.mkdirSync(REPORTS_FOLDER);
}

// Generate output filename
const baseName = path.basename(inputFile, '.csv');
const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
const cleanUrlsFile = path.join(TEMP_FOLDER, `${baseName}-urls.csv`);
const reportFile = path.join(REPORTS_FOLDER, `${baseName}-report-${timestamp}.html`);

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
  execSync(`node "${path.join(__dirname, 'sentiment-analyzer.js')}" "${cleanUrlsFile}" "${reportFile}" "${companyName}"`, { 
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

