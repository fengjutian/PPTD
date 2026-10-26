const fs = require('fs');
const prompt = fs.readFileSync('D:/github/PPTD/.pptd-tmp/h3-prompt.txt', 'utf8').replace(/\r\n/g, '\n').trim();
const args = {
  model: 'MiniMax-H3',
  prompt,
  duration: 5,
  ratio: '16:9',
  resolution: '2K',
};
fs.writeFileSync('D:/github/PPTD/.pptd-tmp/args.json', JSON.stringify(args), 'utf8');
console.log('prompt_chars=' + prompt.length);
console.log('bytes=' + Buffer.byteLength(JSON.stringify(args), 'utf8'));
