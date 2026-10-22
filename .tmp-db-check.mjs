import { DatabaseSync } from "node:sqlite";
const p = process.env.APPDATA + "\\com.pptd.desktop\\pptd.sqlite3";
const db = new DatabaseSync(p, { readOnly: true });
const cols = db.prepare("select * from ai_draft_history limit 1").all();
for (const row of cols) {
  for (const [k, v] of Object.entries(row)) {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    console.log(k, "=", s.length > 200 ? s.slice(0, 200) + `...(len ${s.length})` : s);
  }
}
