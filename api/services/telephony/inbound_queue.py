import time
from dataclasses import dataclass

import redis.asyncio as aioredis
from loguru import logger

from api.constants import (
    INBOUND_QUEUE_MAX_WAIT_SECONDS,
    REDIS_URL,
)


@dataclass(frozen=True)
class InboundQueueAdmission:
    status: str
    position: int
    queue_wait_seconds: int
    enqueued_at: float
    admitted_at: float | None = None
    workflow_run_id: int | None = None

    @property
    def admitted(self) -> bool:
        return self.status == "admitted"

    @property
    def queued(self) -> bool:
        return self.status == "queued"

    @property
    def expired(self) -> bool:
        return self.status == "expired"

    def metadata(self, *, max_wait_seconds: int, retry_seconds: int) -> dict:
        return {
            "enqueued_at": self.enqueued_at,
            "admitted_at": self.admitted_at,
            "queue_wait_seconds": self.queue_wait_seconds,
            "max_wait_seconds": max_wait_seconds,
            "retry_seconds": retry_seconds,
        }


class InboundQueueManager:
    def __init__(self):
        self._redis_client: aioredis.Redis | None = None
        self.key_ttl_seconds = 3600

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis_client is None:
            self._redis_client = await aioredis.from_url(
                REDIS_URL, decode_responses=True
            )
        return self._redis_client

    @staticmethod
    def _queue_key(organization_id: int) -> str:
        return f"inbound_queue:{organization_id}"

    @staticmethod
    def _active_key(organization_id: int) -> str:
        return f"inbound_active_calls:{organization_id}"

    @staticmethod
    def _ticket_key(call_id: str) -> str:
        return f"inbound_ticket:{call_id}"

    @staticmethod
    def _run_key(workflow_run_id: int) -> str:
        return f"inbound_active_run:{workflow_run_id}"

    async def admit_or_queue(
        self,
        *,
        organization_id: int,
        call_id: str,
        max_active_calls: int,
        max_wait_seconds: int = INBOUND_QUEUE_MAX_WAIT_SECONDS,
    ) -> InboundQueueAdmission:
        redis = await self._get_redis()
        now = time.time()
        lua_script = """
        local queue_key = KEYS[1]
        local active_key = KEYS[2]
        local ticket_key = KEYS[3]
        local call_id = ARGV[1]
        local org_id = ARGV[2]
        local now = tonumber(ARGV[3])
        local max_active = tonumber(ARGV[4])
        local max_wait = tonumber(ARGV[5])
        local ttl = tonumber(ARGV[6])

        redis.call('ZREMRANGEBYSCORE', active_key, 0, now - ttl)

        local state = redis.call('HGET', ticket_key, 'state')
        local workflow_run_id = redis.call('HGET', ticket_key, 'workflow_run_id') or ''
        if state == 'admitted' then
            local enqueued_at = redis.call('HGET', ticket_key, 'enqueued_at') or tostring(now)
            local admitted_at = redis.call('HGET', ticket_key, 'admitted_at') or tostring(now)
            local waited = math.max(0, tonumber(admitted_at) - tonumber(enqueued_at))
            return {'admitted', '0', tostring(math.floor(waited)), enqueued_at, admitted_at, workflow_run_id}
        end
        if state == 'expired' then
            local enqueued_at = redis.call('HGET', ticket_key, 'enqueued_at') or tostring(now)
            local expired_at = redis.call('HGET', ticket_key, 'expired_at') or tostring(now)
            local waited = math.max(0, tonumber(expired_at) - tonumber(enqueued_at))
            return {'expired', '0', tostring(math.floor(waited)), enqueued_at, '', ''}
        end
        if state == 'released' then
            local enqueued_at = redis.call('HGET', ticket_key, 'enqueued_at') or tostring(now)
            return {'expired', '0', '0', enqueued_at, '', ''}
        end

        if not state then
            redis.call(
                'HSET',
                ticket_key,
                'organization_id', org_id,
                'call_id', call_id,
                'enqueued_at', now,
                'state', 'queued'
            )
            redis.call('EXPIRE', ticket_key, ttl)
            redis.call('RPUSH', queue_key, call_id)
            redis.call('EXPIRE', queue_key, ttl)
        else
            redis.call('EXPIRE', ticket_key, ttl)
        end

        local enqueued_at = tonumber(redis.call('HGET', ticket_key, 'enqueued_at') or now)
        local waited = math.max(0, now - enqueued_at)

        local items = redis.call('LRANGE', queue_key, 0, -1)
        local position = 0
        for i, value in ipairs(items) do
            if value == call_id and position == 0 then
                position = i
            end
        end
        if position == 0 then
            redis.call('RPUSH', queue_key, call_id)
            redis.call('EXPIRE', queue_key, ttl)
            position = redis.call('LLEN', queue_key)
        end

        if waited > max_wait then
            redis.call('LREM', queue_key, 0, call_id)
            redis.call('HSET', ticket_key, 'state', 'expired', 'expired_at', now)
            return {'expired', tostring(position), tostring(math.floor(waited)), tostring(enqueued_at), '', ''}
        end

        local head = redis.call('LINDEX', queue_key, 0)
        local active_count = redis.call('ZCARD', active_key)
        if head == call_id and active_count < max_active then
            redis.call('LPOP', queue_key)
            redis.call('ZADD', active_key, now, call_id)
            redis.call('EXPIRE', active_key, ttl)
            redis.call('HSET', ticket_key, 'state', 'admitted', 'admitted_at', now)
            return {'admitted', '1', tostring(math.floor(waited)), tostring(enqueued_at), tostring(now), workflow_run_id}
        end

        return {'queued', tostring(position), tostring(math.floor(waited)), tostring(enqueued_at), '', ''}
        """

        try:
            result = await redis.eval(
                lua_script,
                3,
                self._queue_key(organization_id),
                self._active_key(organization_id),
                self._ticket_key(call_id),
                call_id,
                organization_id,
                now,
                max_active_calls,
                max_wait_seconds,
                self.key_ttl_seconds,
            )
        except Exception as e:
            logger.error(
                f"Inbound queue admission failed for org {organization_id}: {e}"
            )
            return InboundQueueAdmission(
                status="admitted",
                position=1,
                queue_wait_seconds=0,
                enqueued_at=now,
                admitted_at=now,
            )

        return InboundQueueAdmission(
            status=result[0],
            position=int(result[1] or 0),
            queue_wait_seconds=int(result[2] or 0),
            enqueued_at=float(result[3] or now),
            admitted_at=float(result[4]) if result[4] else None,
            workflow_run_id=int(result[5]) if result[5] else None,
        )

    async def mark_run_admitted(
        self, *, organization_id: int, call_id: str, workflow_run_id: int
    ) -> None:
        redis = await self._get_redis()
        await redis.hset(
            self._ticket_key(call_id), mapping={"workflow_run_id": workflow_run_id}
        )
        await redis.expire(self._ticket_key(call_id), self.key_ttl_seconds)
        await redis.hset(
            self._run_key(workflow_run_id),
            mapping={"organization_id": organization_id, "call_id": call_id},
        )
        await redis.expire(self._run_key(workflow_run_id), self.key_ttl_seconds)

    async def release_call(
        self, *, organization_id: int, call_id: str, workflow_run_id: int | None = None
    ) -> bool:
        if not call_id:
            return False
        redis = await self._get_redis()
        removed = await redis.zrem(self._active_key(organization_id), call_id)
        await redis.hset(
            self._ticket_key(call_id),
            mapping={"state": "released", "released_at": time.time()},
        )
        await redis.expire(self._ticket_key(call_id), self.key_ttl_seconds)
        if workflow_run_id is not None:
            await redis.delete(self._run_key(workflow_run_id))
        return bool(removed)

    async def release_for_run(self, workflow_run_id: int) -> bool:
        redis = await self._get_redis()
        mapping = await redis.hgetall(self._run_key(workflow_run_id))
        if not mapping:
            return False
        try:
            organization_id = int(mapping["organization_id"])
        except (KeyError, TypeError, ValueError):
            await redis.delete(self._run_key(workflow_run_id))
            return False
        return await self.release_call(
            organization_id=organization_id,
            call_id=mapping.get("call_id", ""),
            workflow_run_id=workflow_run_id,
        )


inbound_queue_manager = InboundQueueManager()


async def get_inbound_queue_manager() -> InboundQueueManager:
    return inbound_queue_manager
