from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_MESSAGE_CHARS = 4000


class ChatRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)
    message: str
    system_prompt: Optional[str] = Field(default=None, max_length=8000)

    @field_validator("session_id")
    @classmethod
    def _session_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("session_id must not be blank")
        return v

    @field_validator("message")
    @classmethod
    def _message_rules(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message must not be empty")
        if len(v) > MAX_MESSAGE_CHARS:
            raise ValueError(f"message must be at most {MAX_MESSAGE_CHARS} characters")
        return v

    @field_validator("system_prompt")
    @classmethod
    def _clean_prompt(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


class ChatMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    resolution_source: str
    model: str
    latency_ms: int
    input_tokens: int
    output_tokens: int
    key_id: Optional[str] = None
    fallback_attempts: int = 0
    attempts: Optional[list] = None
    original_latency_ms: Optional[int] = None


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    metadata: ChatMetadata
