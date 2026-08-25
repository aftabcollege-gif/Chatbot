"""Chat endpoints including SSE streaming responses."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from core import database as db
from core.dependencies import get_current_user
from models.schemas import ChatMessageRequest, ConversationCreate, ConversationUpdate, FeedbackRequest
from services import audit_service, rag_service
from utils.persian import truncate_words

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _conversation_owned(conv_id: str, user_id: str) -> Optional[dict]:
    row = db.query_one(
        "SELECT * FROM conversations WHERE id=? AND user_id=?", (conv_id, user_id)
    )
    return dict(row) if row else None


@router.get("/conversations")
def list_conversations(
    user: dict = Depends(get_current_user),
    page: int = 1,
    limit: int = 30,
    search: Optional[str] = None,
    pinned: Optional[bool] = None,
):
    clauses = ["user_id=?"]
    params: list = [user["id"]]
    if search:
        clauses.append("(title LIKE ?)")
        params.append(f"%{search}%")
    if pinned is not None:
        clauses.append("is_pinned=?")
        params.append(1 if pinned else 0)
    where = " WHERE " + " AND ".join(clauses)
    total = db.query_one(
        f"SELECT COUNT(*) AS c FROM conversations{where}", params
    )["c"]
    rows = db.query_all(
        f"""SELECT * FROM conversations{where}
            ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?""",
        [*params, limit, (page - 1) * limit],
    )
    return {"items": [dict(r) for r in rows], "total": total, "page": page, "limit": limit}


@router.post("/conversations")
def create_conversation(payload: ConversationCreate, user: dict = Depends(get_current_user)):
    title = payload.title or "گفتگوی جدید"
    cid = db.insert_and_pk(
        "conversations",
        {
            "user_id": user["id"],
            "organization_id": user.get("organization_id"),
            "title": title,
        },
    )
    row = db.query_one("SELECT * FROM conversations WHERE id=?", (cid,))
    return dict(row)


@router.get("/conversations/{conv_id}")
def get_conversation(conv_id: str, user: dict = Depends(get_current_user)):
    conv = _conversation_owned(conv_id, user["id"])
    if not conv:
        raise HTTPException(status_code=404, detail="گفتگو یافت نشد.")
    msgs = db.query_all(
        "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC",
        (conv_id,),
    )
    out_msgs = []
    for m in msgs:
        md = dict(m)
        if md["role"] == "assistant":
            srcs = db.query_all(
                "SELECT * FROM message_sources WHERE message_id=? ORDER BY citation_index ASC",
                (md["id"],),
            )
            md["sources"] = [dict(s) for s in srcs]
        out_msgs.append(md)
    return {"conversation": conv, "messages": out_msgs}


@router.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: str, user: dict = Depends(get_current_user)):
    if not _conversation_owned(conv_id, user["id"]):
        raise HTTPException(status_code=404, detail="گفتگو یافت نشد.")
    db.execute("DELETE FROM conversations WHERE id=?", (conv_id,))
    return {"success": True}


@router.patch("/conversations/{conv_id}")
def update_conversation(
    conv_id: str, payload: ConversationUpdate, user: dict = Depends(get_current_user)
):
    conv = _conversation_owned(conv_id, user["id"])
    if not conv:
        raise HTTPException(status_code=404, detail="گفتگو یافت نشد.")
    sets, params = [], []
    if payload.title is not None:
        sets.append("title=?")
        params.append(payload.title)
    if payload.is_pinned is not None:
        sets.append("is_pinned=?")
        params.append(1 if payload.is_pinned else 0)
    sets.append("updated_at=datetime('now')")
    params.append(conv_id)
    db.execute(f"UPDATE conversations SET {', '.join(sets)} WHERE id=?", params)
    return dict(db.query_one("SELECT * FROM conversations WHERE id=?", (conv_id,)))


@router.post("/conversations/{conv_id}/messages")
async def send_message(
    conv_id: str, payload: ChatMessageRequest, user: dict = Depends(get_current_user)
):
    conv = _conversation_owned(conv_id, user["id"])
    if not conv:
        raise HTTPException(status_code=404, detail="گفتگو یافت نشد.")

    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="متن پیام خالی است.")

    # Store user message.
    db.insert_and_pk(
        "messages",
        {
            "conversation_id": conv_id,
            "role": "user",
            "content": content,
            "scope": payload.scope,
            "scope_id": payload.scope_id,
        },
    )
    # Update conversation title on first human message.
    count = db.query_one(
        "SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?", (conv_id,)
    )["c"]
    if count <= 1:
        db.execute(
            "UPDATE conversations SET title=?, updated_at=datetime('now') WHERE id=?",
            (truncate_words(content, 8), conv_id),
        )

    history_rows = db.query_all(
        """SELECT role, content FROM messages
           WHERE conversation_id=? AND role IN ('user','assistant')
           ORDER BY created_at DESC LIMIT 10""",
        (conv_id,),
    )
    history = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]

    queue: asyncio.Queue = asyncio.Queue()
    started = time.time()

    async def producer():
        full_content = []
        sources = []
        confidence = 0.0
        try:
            async for event in rag_service.answer_stream(
                content,
                user,
                history,
                scope=payload.scope,
                scope_id=payload.scope_id,
            ):
                if event["type"] == "token":
                    full_content.append(event["content"])
                elif event["type"] == "sources":
                    sources = event["sources"]
                elif event["type"] == "confidence":
                    confidence = event["score"]
                await queue.put(event)
        except Exception as exc:  # noqa: BLE001
            await queue.put({"type": "error", "message": str(exc)})
        finally:
            # Persist assistant message + sources.
            answer = "".join(full_content).strip()
            mid = db.insert_and_pk(
                "messages",
                {
                    "conversation_id": conv_id,
                    "role": "assistant",
                    "content": answer,
                    "scope": payload.scope,
                    "scope_id": payload.scope_id,
                    "confidence_score": confidence,
                    "response_time_ms": int((time.time() - started) * 1000),
                },
            )
            for s in sources:
                db.execute(
                    """INSERT INTO message_sources
                       (message_id, source_type, source_id, chunk_id, page_number,
                        section, heading, relevance_score, citation_index)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (
                        mid,
                        s["source_type"],
                        s["source_id"],
                        s.get("chunk_id"),
                        s.get("page_number"),
                        s.get("section"),
                        s.get("heading"),
                        s.get("relevance_score"),
                        s["citation_index"],
                    ),
                )
            db.execute(
                "UPDATE conversations SET updated_at=datetime('now') WHERE id=?",
                (conv_id,),
            )
            await queue.put({"type": "done", "message_id": mid})

    async def event_stream():
        task = asyncio.create_task(producer())
        try:
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in ("done", "error"):
                    break
        finally:
            if not task.done():
                task.cancel()
            await task

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/messages/{message_id}/feedback")
def feedback(
    message_id: str, payload: FeedbackRequest, user: dict = Depends(get_current_user)
):
    row = db.query_one(
        """SELECT m.* FROM messages m
           JOIN conversations c ON c.id=m.conversation_id
           WHERE m.id=? AND c.user_id=?""",
        (message_id, user["id"]),
    )
    if not row:
        raise HTTPException(status_code=404, detail="پیام یافت نشد.")
    db.execute(
        "UPDATE messages SET feedback=?, feedback_reason=? WHERE id=?",
        (payload.type, payload.reason, message_id),
    )
    return {"success": True}


@router.get("/conversations/{conv_id}/export")
def export_conversation(
    conv_id: str,
    format: str = Query("markdown", pattern="^(markdown|txt|pdf)$"),
    user: dict = Depends(get_current_user),
):
    conv = _conversation_owned(conv_id, user["id"])
    if not conv:
        raise HTTPException(status_code=404, detail="گفتگو یافت نشد.")
    msgs = db.query_all(
        "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC",
        (conv_id,),
    )
    if format in ("markdown", "txt"):
        lines = [f"# {conv['title']}", ""]
        for m in msgs:
            who = "کاربر" if m["role"] == "user" else "دستیار"
            lines.append(f"**{who}:** {m['content']}")
            lines.append("")
        body = "\n".join(lines)
        from fastapi.responses import PlainTextResponse

        return PlainTextResponse(
            body,
            media_type="text/markdown" if format == "markdown" else "text/plain",
            headers={
                "Content-Disposition": f'attachment; filename="conversation-{conv_id}.{format}"'
            },
        )
    # Minimal PDF without extra deps: return markdown labeled for the client.
    from fastapi.responses import PlainTextResponse

    body = "\n".join(
        f"{'کاربر' if m['role'] == 'user' else 'دستیار'}: {m['content']}" for m in msgs
    )
    return PlainTextResponse(
        body,
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="conversation-{conv_id}.txt"'},
    )
