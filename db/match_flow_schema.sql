-- Run in Supabase SQL editor.
-- Implements Section 7 of the Matchmaking & Curated Match Flow spec.
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS throughout.

-- ─────────────────────────────────────────────────────────────────────────────
-- 7.1  proposed_matches
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.proposed_matches (
  id                        uuid        primary key default gen_random_uuid(),
  user_a_id                 uuid        not null references public.onboarding_profiles (id) on delete cascade,
  user_b_id                 uuid        not null references public.onboarding_profiles (id) on delete cascade,

  -- Algorithm output
  compatibility_score       numeric(5,4) not null check (compatibility_score between 0 and 1),
  score_breakdown           jsonb,        -- { lifestyle, values, personality, energy, communication }
  reasoning                 text,         -- Claude narrative: why they could click
  risks                     text[],       -- Claude flagged concerns
  suggested_intro_hook      text,         -- one-sentence strongest connection point
  reasons                   text[],       -- short bullet strings for quick display

  -- Match status (state machine from Section 6)
  status                    text        not null default 'pending_review'
                              check (status in (
                                'pending_review',
                                'rejected_by_founder',
                                'approved',
                                'awaiting_responses',
                                'awaiting_one_response',
                                'declined',
                                'mutual_yes',
                                'introduced',
                                'expired'
                              )),

  -- Founder actions
  approved_by_founder_at    timestamptz,
  approved_by_founder_id    uuid,         -- references admin user
  founder_edited_intro      text,         -- Andy's edited version of suggested_intro_hook

  -- User A consent
  user_a_response           text          check (user_a_response in ('pending', 'interested', 'declined', 'expired')),
  user_a_responded_at       timestamptz,
  user_a_pass_reason        text,
  user_a_invite_message_id  text,         -- Linq message ID for the 1:1 invite
  user_a_invite_chat_id     text,         -- Linq chat ID for the 1:1 invite

  -- User B consent
  user_b_response           text          check (user_b_response in ('pending', 'interested', 'declined', 'expired')),
  user_b_responded_at       timestamptz,
  user_b_pass_reason        text,
  user_b_invite_message_id  text,
  user_b_invite_chat_id     text,

  -- Group chat (post mutual-yes)
  linq_chat_id              text,         -- GC chat ID once created
  gc_created_at             timestamptz,
  opener_message_id         text,
  opener_message_sent_at    timestamptz,
  safety_message_id         text,
  safety_message_sent_at    timestamptz,

  -- Lifecycle
  sending_line              text,         -- which Linq line was used
  expires_at                timestamptz,  -- default: approved_at + 7 days
  created_at                timestamptz   not null default now(),
  updated_at                timestamptz   not null default now(),

  -- A pair should never appear twice
  unique (user_a_id, user_b_id)
);

create index if not exists idx_proposed_matches_status
  on public.proposed_matches (status);

create index if not exists idx_proposed_matches_score_desc
  on public.proposed_matches (compatibility_score desc);

create index if not exists idx_proposed_matches_created_at
  on public.proposed_matches (created_at desc);

create or replace function public._proposed_matches_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_proposed_matches_updated on public.proposed_matches;
create trigger trg_proposed_matches_updated
  before update on public.proposed_matches
  for each row execute function public._proposed_matches_touch_updated_at();

alter table public.proposed_matches enable row level security;
-- No policies: admin APIs use service role.


-- ─────────────────────────────────────────────────────────────────────────────
-- 7.2  excluded_pairs  (pairs the algorithm must never re-propose)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.excluded_pairs (
  id          uuid  primary key default gen_random_uuid(),
  user_a_id   uuid  not null references public.onboarding_profiles (id) on delete cascade,
  user_b_id   uuid  not null references public.onboarding_profiles (id) on delete cascade,
  reason      text  not null
                check (reason in (
                  'rejected_by_founder',
                  'declined_by_user_a',
                  'declined_by_user_b',
                  'mutual_decline',
                  'expired',
                  'manual_block'
                )),
  match_id    uuid  references public.proposed_matches (id) on delete set null,
  created_at  timestamptz not null default now(),

  -- Canonical ordering: always store lower uuid first so lookups are O(1)
  unique (user_a_id, user_b_id)
);

create index if not exists idx_excluded_pairs_user_a on public.excluded_pairs (user_a_id);
create index if not exists idx_excluded_pairs_user_b on public.excluded_pairs (user_b_id);

alter table public.excluded_pairs enable row level security;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7.3  sms_messages — universal messages table extensions
--      Adds Linq-specific fields to the existing table.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sms_messages
  add column if not exists linq_message_id      text unique,   -- dedup: Linq may deliver same event twice
  add column if not exists linq_chat_id         text,          -- chat this message belongs to
  add column if not exists service              text,          -- 'iMessage' | 'RCS' | 'SMS'
  add column if not exists parts                jsonb,         -- raw parts array from Linq
  add column if not exists delivery_status      text,          -- 'sent' | 'delivered' | 'read' | 'failed'
  add column if not exists delivered_at         timestamptz,
  add column if not exists read_at              timestamptz,
  add column if not exists failure_code         int,
  add column if not exists failure_reason       text,
  add column if not exists conversation_context text,          -- 'onboarding' | 'match_invite' | 'gc' | 'freeform'
  add column if not exists match_id             uuid references public.proposed_matches (id) on delete set null;

create index if not exists idx_sms_messages_linq_chat_id
  on public.sms_messages (linq_chat_id)
  where linq_chat_id is not null;

create index if not exists idx_sms_messages_match_id
  on public.sms_messages (match_id)
  where match_id is not null;
