-- =====================================================================
-- 001_core_schema.sql
-- Tabelas centrais da TRIVIA PLATFORM (multi-tenant).
-- Prefixo "tp_" para nunca colidir com as tabelas que já existem
-- e pertencem ao trivia-webhook (TRIVIA, bandeirante, etc).
-- =====================================================================

-- Tabela das empresas (clientes da plataforma)
create table tp_companies (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  name text not null,
  phone_number_id text,
  whatsapp_token text,
  business_type text not null check (business_type in ('agendamento', 'pedido', 'orcamento')),
  config jsonb default '{}'::jsonb
);

-- Tabela dos leads (pessoas que já conversaram com algum cliente)
create table tp_leads (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  company_id bigint not null references tp_companies(id),
  phone text not null,
  stage text not null default 'frio' check (stage in ('frio', 'morno', 'quente')),
  unique (company_id, phone)
);

-- Tabela das interações (histórico de mensagens, ligado ao lead)
create table tp_lead_interactions (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  lead_id bigint not null references tp_leads(id),
  message text
);