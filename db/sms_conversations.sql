-- Run in Supabase SQL editor.
-- Stores SMS conversation threads and messages (outbound + inbound webhook replies).

create table if not exists public.sms_conversations (
  id uuid primary key default gen_random_uuid(),
  participant_phone_e164 text not null,
  telnyx_phone_e164 text not null,
  provider text not null default 'telnyx' check (provider in ('telnyx', 'linq')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sms_conversations_provider_participant
  on public.sms_conversations (provider, participant_phone_e164);

create index if not exists idx_sms_conversations_last_message_at
  on public.sms_conversations (last_message_at desc);

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sms_conversations (id) on delete cascade,
  provider_message_id text unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_phone_e164 text not null,
  to_phone_e164 text not null,
  body text not null default '',
  provider text not null default 'telnyx' check (provider in ('telnyx', 'linq')),
  event_type text,
  status text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sms_messages_conversation_created_at
  on public.sms_messages (conversation_id, created_at);

create or replace function public._sms_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sms_conversations_updated on public.sms_conversations;
create trigger trg_sms_conversations_updated
  before update on public.sms_conversations
  for each row execute function public._sms_touch_updated_at();

alter table public.sms_conversations enable row level security;
alter table public.sms_messages enable row level security;

-- No policies by default: admin APIs use service role.
