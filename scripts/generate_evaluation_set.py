from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import fitz
from ollama import chat


QUESTION_TYPES = [
    (
        "definition",
        "Write questions that ask what a concept, service, tool, or term means.",
        "easy",
    ),
    (
        "conceptual",
        "Write questions that ask why something matters, how it works, or what principle it illustrates.",
        "medium",
    ),
    (
        "comparison",
        "Write questions that compare two related ideas, services, methods, or options mentioned in the PDF.",
        "medium",
    ),
    (
        "scenario",
        "Write questions that present a real-world use case and ask what would be the best choice or approach.",
        "hard",
    ),
]


@dataclass(frozen=True)
class PageExcerpt:
    page_number: int
    text: str


def clean_text(text: str) -> str:
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def load_pdf_pages(pdf_path: Path) -> list[PageExcerpt]:
    with fitz.open(pdf_path) as pdf:
        pages: list[PageExcerpt] = []
        for page_number, page in enumerate(pdf, start=1):
            text = clean_text(page.get_text("text"))
            if text:
                pages.append(PageExcerpt(page_number=page_number, text=text))
    return pages


def select_evenly_spaced(items: list[PageExcerpt], count: int) -> list[PageExcerpt]:
    if not items:
        return []
    if len(items) <= count:
        return items

    selected: list[PageExcerpt] = []
    last_index = len(items) - 1
    for index in range(count):
        position = round(index * last_index / max(count - 1, 1))
        candidate = items[position]
        if candidate not in selected:
            selected.append(candidate)
    return selected


def build_excerpts(pages: list[PageExcerpt], max_pages: int = 8, max_chars: int = 9000) -> str:
    selected_pages = select_evenly_spaced(pages, max_pages)
    excerpts: list[str] = []
    running_length = 0

    for page in selected_pages:
        block = f"[Page {page.page_number}] {page.text}"
        if running_length + len(block) > max_chars and excerpts:
            break
        excerpts.append(block)
        running_length += len(block)

    return "\n\n".join(excerpts)


def extract_json_block(text: str) -> str:
    text = text.strip()
    if text.startswith("{") and text.endswith("}"):
        return text

    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if match:
        return match.group(0)

    raise ValueError("Model response did not contain a JSON object.")


def generate_questions_for_type(
    *,
    model: str,
    document_name: str,
    question_type: str,
    difficulty: str,
    guidance: str,
    excerpts: str,
    questions_per_type: int,
) -> list[dict[str, str]]:
    prompt = f"""You are creating a retrieval evaluation set for a RAG system.

Use only the information present in the PDF excerpts below.

Document: {document_name}
Question type: {question_type}
Target difficulty: {difficulty}

Type guidance:
{guidance}

Requirements:
- Create exactly {questions_per_type} distinct questions.
- The questions must be answerable from the document excerpts.
- Do not provide answers.
- Avoid overly simple fact-only questions unless the type is definition.
- Make the questions varied and natural.
- Return valid JSON only.

Return this shape:
{{
  "questions": [
    {{
      "question": "...",
      "expected_document": "{document_name}",
      "difficulty": "{difficulty}",
      "type": "{question_type}"
    }}
  ]
}}

PDF excerpts:
{excerpts}
"""

    response = chat(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You generate only valid JSON for evaluation datasets. "
                    "Never include markdown, commentary, or code fences."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        options={"temperature": 0.2},
    )

    payload = json.loads(extract_json_block(response.message.content))
    questions = payload.get("questions", [])

    if len(questions) != questions_per_type:
        raise ValueError(
            f"Expected {questions_per_type} questions for {document_name} / {question_type}, "
            f"got {len(questions)}"
        )

    normalized_questions: list[dict[str, str]] = []
    for item in questions:
        normalized_questions.append(
            {
                "question": str(item["question"]).strip(),
                "expected_document": document_name,
                "difficulty": str(item.get("difficulty", difficulty)).strip(),
                "type": str(item.get("type", question_type)).strip(),
            }
        )

    return normalized_questions


def iter_pdf_files(knowledge_base_dir: Path) -> Iterable[Path]:
    return sorted(knowledge_base_dir.glob("*.pdf"))


def build_dataset(
    *,
    knowledge_base_dir: Path,
    model: str,
    questions_per_type: int,
    output_path: Path,
) -> list[dict[str, str]]:
    dataset: list[dict[str, str]] = []

    pdf_files = list(iter_pdf_files(knowledge_base_dir))
    if not pdf_files:
        raise FileNotFoundError(f"No PDF files found in {knowledge_base_dir}")

    for pdf_path in pdf_files:
        print(f"Processing {pdf_path.name} ...")
        pages = load_pdf_pages(pdf_path)
        if not pages:
            print(f"  Skipping {pdf_path.name}: no extractable text found")
            continue

        excerpts = build_excerpts(pages)
        if not excerpts:
            print(f"  Skipping {pdf_path.name}: no usable excerpts found")
            continue

        for question_type, guidance, difficulty in QUESTION_TYPES:
            print(f"  Generating {question_type} questions ...")
            questions = generate_questions_for_type(
                model=model,
                document_name=pdf_path.name,
                question_type=question_type,
                difficulty=difficulty,
                guidance=guidance,
                excerpts=excerpts,
                questions_per_type=questions_per_type,
            )
            dataset.extend(questions)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8") as file_handle:
            json.dump(dataset, file_handle, ensure_ascii=False, indent=2)
        print(f"  Checkpointed {len(dataset)} questions to {output_path}")

    return dataset


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a Qwen-based evaluation set for the LangChain RAG PDFs."
    )
    parser.add_argument(
        "--knowledge-base",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "knowledge-base",
        help="Directory containing the PDF files.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data" / "evaluation_set.json",
        help="Path to write the consolidated JSON evaluation set.",
    )
    parser.add_argument(
        "--model",
        default="qwen3:8b",
        help="Ollama Qwen model to use for question generation.",
    )
    parser.add_argument(
        "--questions-per-type",
        type=int,
        default=5,
        help="Number of questions to generate for each question type.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.questions_per_type <= 0:
        raise ValueError("--questions-per-type must be greater than zero")

    dataset = build_dataset(
        knowledge_base_dir=args.knowledge_base,
        model=args.model,
        questions_per_type=args.questions_per_type,
        output_path=args.output,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as file_handle:
        json.dump(dataset, file_handle, ensure_ascii=False, indent=2)

    print(f"Wrote {len(dataset)} questions to {args.output}")


if __name__ == "__main__":
    main()