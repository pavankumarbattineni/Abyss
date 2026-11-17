# Document & photo upload — design direction

Status: **direction agreed, not implemented** · Last updated: 2026-11-17
Static UI already in code: `abyss_frontend/src/components/shared/attach-menu.tsx` — the composer "+" menu with
"Attach files" and "Attach photos", both disabled and marked "Coming soon".

## 1. Decision
- **PDFs and images go natively to the agent's model** through the provider API (OpenAI, Anthropic and Gemini all accept PDF and image content; LangChain `{"type": "file", ...}` / image blocks). The model sees page images + text, so scans, tables and charts work.
- **All other types** (DOCX, PPTX, XLSX/CSV, HTML, TXT/MD/JSON, EPUB) are converted to Markdown with Microsoft **MarkItDown**.
- Audio and video are out of scope for now.

## 2. MarkItDown evaluation (v0.1.9, 2026-11-17)
Tested on the Trench/Abyss documentation PDFs, their HTML source, a rasterised "scanned" PDF and DOCX/XLSX/PPTX files built from the same content.

| Input | Result |
|---|---|
| PDF (67 / 44 pages) | ❌ ~20 s each; headings lost, wrapped table cells shredded, diagrams became fake tables, page numbers in text, code indentation lost |
| Scanned PDF | ❌ empty output, no error |
| HTML | ✅ excellent |
| DOCX | ✅ good (code indentation lost; header-less tables get an empty header row) |
| PPTX | ✅ excellent (slides, tables, speaker notes) |
| XLSX | ⚠️ good, but `NaN` for blanks/uncached formulas, ints become floats |
| Corrupt / encrypted | ✅ clean `FileConversionException` |
| Wrong extension | ✅ detected by content (Magika) |

Costs: +~130 MB RSS (onnxruntime + magika are core deps, plus pandas), 231 MB install, ~1.7 s warm import, CPU-bound
(~0.3 s/PDF page). Security: use **only `convert_stream()`** (generic `convert()` accepts `file:`/`http:` URIs → local file
read / SSRF); don't accept ZIP (recursive conversion). MIT licence, pre-1.0 → pin the version.

## 3. Design points
1. **Route by detected type** (content sniffing), with an allowlist; convert HEIC/TIFF to PNG for providers that reject them.
2. **Model capability flags** in `provider_models` (e.g. `supports_documents`, `supports_images`); disable attaching for models that can't read files.
3. **Provider limits** (size/pages differ): check up front; oversize PDF → reject with a clear message, or fall back to MarkItDown text with a warning.
4. **Never put file bytes in LangGraph state/checkpoints.** Store files ourselves (attachments table + storage), put a small reference in the user message, and resolve it to a provider file block in a `wrap_model_call` middleware just before the model call.
5. **Cost per turn:** send the full file on the upload turn and when referenced; summaries otherwise. Reuse provider file IDs where available (Gemini File API files expire after ~48 h → track expiry, re-upload or inline).
6. **Converted text is untrusted:** wrap in `<attachment name="…">` delimiters, cap its size, instruct the model not to follow instructions inside, clean up (`NaN`, escaped `\_`, page numbers).
7. **Sub-agents and MCP tools don't see files automatically** — the parent passes the relevant content in the task.
8. **Runtime:** lazy-load MarkItDown in a worker thread with a timeout (Render 512 MB); friendly error codes `unsupported_file`, `file_too_large`.

## 4. Open decisions
- Per-chat attachments only, or also a reusable per-user knowledge base (that would be search/RAG like Trench)?
- Storage for originals: Postgres (small files) vs object storage (B2, as Trench uses).
- Maximum file size / pages per upload and per thread.
