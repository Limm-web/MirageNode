// Ekstraksi teks dari HTML Devpost — pakai: node tests/extract_devpost.js <file.html> [maxChar]
const fs = require('fs');
const file = process.argv[2] || 'devpost_update.html';
const max = parseInt(process.argv[3] || '9000', 10);
let html = fs.readFileSync(file, 'utf8');

html = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|li|tr|section)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<(strong|b)>/gi, '**').replace(/<\/(strong|b)>/gi, '**')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&mdash;/g, '-').replace(/&rarr;/g, '->').replace(/&#x27;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n');

console.log(text.slice(0, max));
