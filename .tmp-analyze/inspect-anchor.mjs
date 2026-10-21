import JSZip from "jszip";
import { readFileSync } from "node:fs";

const zip = await JSZip.loadAsync(readFileSync(".tmp-analyze/deck.pptx"));
const xml = await zip.file("ppt/slides/slide2.xml").async("string");
const bodies = [...xml.matchAll(/<a:bodyPr[^>]*\/?>/g)].map((m) => m[0]);
console.log("bodyPr:", bodies.slice(0, 5).join("\n         "));
console.log('has anchor="ctr":', xml.includes('anchor="ctr"'));
console.log('has anchor="t":', xml.includes('anchor="t"'));
