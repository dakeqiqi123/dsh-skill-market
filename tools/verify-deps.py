"""Verify the lightweight dependency set actually imports.

Run with the DSH runtime interpreter. Writes a JSON result next to itself so the
answer does not depend on capturing a child process's stdout.
"""
import importlib
import json
import os
import sys

# Import name -> the skill that needs it, so a failure names the consequence.
TARGETS = {
    "fitz": "audit-report-checker / local-rag (PDF)",
    "pdfplumber": "audit-report-checker (PDF tables)",
    "json_repair": "audit-report-checker (LLM JSON)",
    "openai": "audit-report-checker (LLM calls)",
    "bs4": "chen-yiwei-perspective (HTML)",
    "markdownify": "chen-yiwei-perspective (HTML->MD)",
    "requests": "chen-yiwei-perspective / cicpa-company-query / local-rag",
    "yaml": "flowchart-generator / local-rag / china-law-search",
    "rapidfuzz": "bank-flow-reconciliation (fuzzy match)",
    "xlrd": "bank-flow-reconciliation (legacy xls)",
    "openpyxl": "several (xlsx)",
    "pandas": "several",
    "numpy": "bank-flow-reconciliation",
    "docx": "several with the bundled python-docx",
}

results = {}
for name, why in TARGETS.items():
    try:
        module = importlib.import_module(name)
        version = getattr(module, "__version__", None)
        results[name] = {"ok": True, "why": why, "version": str(version) if version else None}
    except Exception as error:  # noqa: BLE001 - the report wants the reason verbatim
        results[name] = {"ok": False, "why": why, "error": f"{type(error).__name__}: {error}"}

payload = {
    "python": sys.version.split()[0],
    "executable": sys.executable,
    "results": results,
    "failed": sorted(name for name, item in results.items() if not item["ok"]),
}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "verify-deps-result.json")
with open(out, "w", encoding="utf-8") as handle:
    handle.write(json.dumps(payload, ensure_ascii=False, indent=2))
print(json.dumps(payload["failed"], ensure_ascii=False))
