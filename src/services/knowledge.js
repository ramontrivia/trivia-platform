import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const KNOWLEDGE_ROOT = join(__dirname, "../../knowledge");

export function loadKnowledge(clientKey) {
  try {
    if (!clientKey) return "";
    const folder = join(KNOWLEDGE_ROOT, String(clientKey));
    if (!existsSync(folder)) return "";
    const files = readdirSync(folder).filter((f) => f.endsWith(".txt")).sort();
    if (!files.length) return "";
    return files.map((file) => {
      try { return readFileSync(join(folder, file), "utf-8"); }
      catch { return ""; }
    }).filter(Boolean).join("\n\n");
  } catch { return ""; }
}

export function loadKnowledgePhase(clientKey, phase) {
  try {
    if (!clientKey) return "";
    const allowed = ["frio", "morno", "quente"];
    const safePhase = allowed.includes(phase) ? phase : "frio";
    const filePath = join(KNOWLEDGE_ROOT, String(clientKey), "fases", safePhase + ".txt");
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf-8");
  } catch { return ""; }
}

export default loadKnowledge;
