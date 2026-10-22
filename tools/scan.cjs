const fs = require("fs");
const file = process.argv[2];
const pattern = new RegExp(process.argv[3]);
fs.readFileSync(file, "utf8")
  .split("\n")
  .forEach((line, index) => {
    if (pattern.test(line)) console.log(`${index + 1}: ${line}`);
  });
