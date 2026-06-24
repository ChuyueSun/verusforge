import hljs from "highlight.js/lib/core";
import rust from "highlight.js/lib/languages/rust";

hljs.registerLanguage("rust", rust);

export function highlightRust(code: string): string {
  try {
    return hljs.highlight(code, { language: "rust" }).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
