"""Local document parsing and chunking for the knowledge base.

This keeps OSS deployments self-hosted: uploaded files are downloaded from
storage, text is extracted locally, and only embedding requests go to the
configured embedding provider.
"""

from __future__ import annotations

import csv
import html
import json
import re
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


class DocumentProcessingError(Exception):
    """Raised when a file cannot be parsed into text."""


@dataclass(frozen=True)
class ProcessedChunk:
    chunk_text: str
    contextualized_text: str
    chunk_index: int
    chunk_metadata: dict[str, Any]
    token_count: int


@dataclass(frozen=True)
class ProcessedDocument:
    full_text: str
    chunks: list[ProcessedChunk]
    metadata: dict[str, Any]


class _TextHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if text:
            self._parts.append(text)

    def text(self) -> str:
        return "\n".join(self._parts)


def process_document_local(
    *,
    file_path: str,
    filename: str,
    mime_type: str | None,
    retrieval_mode: str,
    max_tokens: int = 480,
) -> ProcessedDocument:
    """Extract text and build retrieval chunks for a document."""
    path = Path(file_path)
    text, metadata = _extract_text(path, filename, mime_type)
    text = _normalize_text(text)
    if not text:
        raise DocumentProcessingError("No readable text was found in this document.")

    chunks: list[ProcessedChunk] = []
    if retrieval_mode != "full_document":
        chunks = _chunk_text(text, filename=filename, max_tokens=max_tokens)

    metadata.update(
        {
            "processor": "local_fast_rag_v1",
            "retrieval_mode": retrieval_mode,
            "chunk_count": len(chunks),
            "text_length": len(text),
        }
    )
    return ProcessedDocument(full_text=text, chunks=chunks, metadata=metadata)


def _extract_text(
    path: Path, filename: str, mime_type: str | None
) -> tuple[str, dict[str, Any]]:
    extension = path.suffix.lower() or Path(filename).suffix.lower()
    metadata: dict[str, Any] = {
        "filename": filename,
        "mime_type": mime_type,
        "extension": extension,
    }

    if extension == ".pdf" or mime_type == "application/pdf":
        return _extract_pdf(path), metadata

    if extension == ".docx":
        return _extract_docx(path), metadata

    if extension in {".txt", ".md", ".markdown"} or (
        mime_type and mime_type.startswith("text/")
    ):
        return _read_text_file(path), metadata

    if extension == ".json" or mime_type == "application/json":
        raw = _read_text_file(path)
        try:
            return json.dumps(json.loads(raw), ensure_ascii=False, indent=2), metadata
        except json.JSONDecodeError:
            return raw, metadata

    if extension == ".csv" or mime_type == "text/csv":
        return _extract_csv(path), metadata

    if extension in {".html", ".htm"} or mime_type == "text/html":
        parser = _TextHTMLParser()
        parser.feed(_read_text_file(path))
        return html.unescape(parser.text()), metadata

    raise DocumentProcessingError(
        "Unsupported file type. Use PDF, DOCX, TXT, Markdown, CSV, JSON, or HTML."
    )


def _read_text_file(path: Path) -> str:
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _extract_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except Exception as exc:  # pragma: no cover - depends on runtime image deps
        raise DocumentProcessingError(
            "PDF parsing requires the pypdf package. Rebuild/restart the Docker dev "
            "stack so api/requirements.txt is installed."
        ) from exc

    reader = PdfReader(str(path))
    pages = []
    for index, page in enumerate(reader.pages):
        page_text = page.extract_text() or ""
        if page_text.strip():
            pages.append(f"[Page {index + 1}]\n{page_text}")
    return "\n\n".join(pages)


def _extract_docx(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            document_xml = archive.read("word/document.xml")
    except Exception as exc:
        raise DocumentProcessingError(
            "Could not read this DOCX file. Please re-save it as DOCX or upload PDF/TXT."
        ) from exc

    root = ElementTree.fromstring(document_xml)
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", namespace):
        texts = [
            node.text or ""
            for node in paragraph.findall(".//w:t", namespace)
            if node.text
        ]
        line = "".join(texts).strip()
        if line:
            paragraphs.append(line)
    return "\n\n".join(paragraphs)


def _extract_csv(path: Path) -> str:
    raw = _read_text_file(path)
    rows: list[str] = []
    reader = csv.reader(raw.splitlines())
    for row in reader:
        if row:
            rows.append(" | ".join(cell.strip() for cell in row))
    return "\n".join(rows)


def _normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _split_paragraphs(text: str) -> list[str]:
    blocks = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]
    if blocks:
        return blocks
    return [line.strip() for line in text.splitlines() if line.strip()]


def _split_long_block(block: str, max_chars: int) -> list[str]:
    if len(block) <= max_chars:
        return [block]

    sentences = re.split(r"(?<=[.!?])\s+", block)
    parts: list[str] = []
    current = ""
    for sentence in sentences:
        if not sentence:
            continue
        if current and len(current) + len(sentence) + 1 > max_chars:
            parts.append(current.strip())
            current = sentence
        else:
            current = f"{current} {sentence}".strip()

    if current:
        parts.append(current.strip())

    if len(parts) == 1 and len(parts[0]) > max_chars:
        return [parts[0][i : i + max_chars] for i in range(0, len(parts[0]), max_chars)]
    return parts


def _chunk_text(text: str, *, filename: str, max_tokens: int) -> list[ProcessedChunk]:
    max_chars = max(900, max_tokens * 4)
    overlap_chars = min(300, max_chars // 6)
    paragraphs: list[str] = []
    for block in _split_paragraphs(text):
        paragraphs.extend(_split_long_block(block, max_chars))

    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if current and len(candidate) > max_chars:
            chunks.append(current.strip())
            overlap = current[-overlap_chars:].strip()
            current = f"{overlap}\n\n{paragraph}".strip() if overlap else paragraph
        else:
            current = candidate

    if current:
        chunks.append(current.strip())

    processed: list[ProcessedChunk] = []
    for index, chunk in enumerate(chunks):
        contextualized = f"Source: {filename}\nChunk {index + 1}:\n{chunk}"
        processed.append(
            ProcessedChunk(
                chunk_text=chunk,
                contextualized_text=contextualized,
                chunk_index=index,
                chunk_metadata={
                    "source": filename,
                    "strategy": "paragraph_window",
                    "max_chars": max_chars,
                    "overlap_chars": overlap_chars,
                },
                token_count=_estimate_tokens(chunk),
            )
        )
    return processed
