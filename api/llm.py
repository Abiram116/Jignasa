"""LLM provider abstraction for BYOK (bring your own key).

Default path is local Ollama, unchanged. When a request carries a cloud
provider + API key, the same streaming chat shape is produced by calling
that provider's SDK directly instead -- callers in api/main.py don't need
to branch on provider, just on the LLMChunk fields below.

The API key is never written to disk by this module: it's accepted as a
plain argument, used for one client construction, and discarded when the
generator returns. Callers must not pass it to anything that persists
(api/db.py, api/cache.py).
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from ollama import chat as ollama_chat

from api.config import OLLAMA_MODEL

DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_ANTHROPIC_MODEL = "claude-3-5-haiku-latest"
DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"


@dataclass
class LLMChunk:
    content: str
    done: bool
    prompt_tokens: int = 0
    completion_tokens: int = 0


def stream_chat(
    messages: list[dict],
    *,
    temperature: float,
    num_predict: int,
    provider: str = "ollama",
    api_key: str | None = None,
    model: str | None = None,
) -> Iterator[LLMChunk]:
    if provider == "openai" and api_key:
        yield from _stream_openai(messages, temperature, num_predict, api_key, model)
    elif provider == "anthropic" and api_key:
        yield from _stream_anthropic(messages, temperature, num_predict, api_key, model)
    elif provider == "gemini" and api_key:
        yield from _stream_gemini(messages, temperature, num_predict, api_key, model)
    else:
        yield from _stream_ollama(messages, temperature, num_predict, model)


def _stream_ollama(messages: list[dict], temperature: float, num_predict: int, model: str | None = None) -> Iterator[LLMChunk]:
    # `model` here is the user's chosen *final-answer* model only -- the
    # reasoning/decision loop (api/agent.py) and memory extraction
    # (api/memory.py) always use OLLAMA_MODEL regardless of this setting.
    # Their tool-selection reliability was specifically calibrated against
    # that one model (scripts/eval_tool_selection.py) and isn't validated
    # for whatever else a user might have pulled locally.
    for chunk in ollama_chat(
        model=model or OLLAMA_MODEL,
        messages=messages,
        stream=True,
        think=False,
        options={"temperature": temperature, "num_predict": num_predict},
    ):
        yield LLMChunk(
            content=chunk.message.content or "",
            done=bool(chunk.done),
            prompt_tokens=chunk.prompt_eval_count or 0 if chunk.done else 0,
            completion_tokens=chunk.eval_count or 0 if chunk.done else 0,
        )


def _stream_openai(
    messages: list[dict], temperature: float, num_predict: int, api_key: str, model: str | None,
) -> Iterator[LLMChunk]:
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    stream = client.chat.completions.create(
        model=model or DEFAULT_OPENAI_MODEL,
        messages=messages,
        temperature=temperature,
        max_tokens=num_predict,
        stream=True,
        stream_options={"include_usage": True},
    )

    prompt_tokens = 0
    completion_tokens = 0
    for event in stream:
        if event.usage:
            prompt_tokens = event.usage.prompt_tokens or 0
            completion_tokens = event.usage.completion_tokens or 0
        if event.choices:
            delta = event.choices[0].delta.content
            if delta:
                yield LLMChunk(content=delta, done=False)
    yield LLMChunk(content="", done=True, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)


def _stream_gemini(
    messages: list[dict], temperature: float, num_predict: int, api_key: str, model: str | None,
) -> Iterator[LLMChunk]:
    from google import genai
    from google.genai import types

    system = ""
    contents = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            role = "model" if m["role"] == "assistant" else "user"
            contents.append(types.Content(role=role, parts=[types.Part(text=m["content"])]))

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content_stream(
        model=model or DEFAULT_GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            max_output_tokens=num_predict,
        ),
    )

    prompt_tokens = 0
    completion_tokens = 0
    for chunk in response:
        if chunk.text:
            yield LLMChunk(content=chunk.text, done=False)
        usage = getattr(chunk, "usage_metadata", None)
        if usage:
            prompt_tokens = usage.prompt_token_count or 0
            completion_tokens = usage.candidates_token_count or 0
    yield LLMChunk(content="", done=True, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)


def _stream_anthropic(
    messages: list[dict], temperature: float, num_predict: int, api_key: str, model: str | None,
) -> Iterator[LLMChunk]:
    from anthropic import Anthropic

    system = ""
    convo = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            convo.append(m)

    client = Anthropic(api_key=api_key)
    with client.messages.stream(
        model=model or DEFAULT_ANTHROPIC_MODEL,
        system=system,
        messages=convo,
        max_tokens=num_predict,
        temperature=temperature,
    ) as stream:
        for text in stream.text_stream:
            yield LLMChunk(content=text, done=False)
        final = stream.get_final_message()
        yield LLMChunk(
            content="",
            done=True,
            prompt_tokens=final.usage.input_tokens,
            completion_tokens=final.usage.output_tokens,
        )
