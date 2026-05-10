-- Run in Supabase SQL editor to support multiple SMS providers.

alter table public.sms_conversations
  add column if not exists provider text not null default 'telnyx';

alter table public.sms_messages
  add column if not exists provider text not null default 'telnyx';

alter table public.sms_conversations
  drop constraint if exists sms_conversations_provider_check;
alter table public.sms_conversations
  add constraint sms_conversations_provider_check check (provider in ('telnyx', 'linq'));

alter table public.sms_messages
  drop constraint if exists sms_messages_provider_check;
alter table public.sms_messages
  add constraint sms_messages_provider_check check (provider in ('telnyx', 'linq'));

create index if not exists idx_sms_conversations_provider_last
  on public.sms_conversations (provider, last_message_at desc);
