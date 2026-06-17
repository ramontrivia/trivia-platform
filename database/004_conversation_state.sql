-- =====================================================================
-- 004_conversation_state.sql
-- Guarda "em que ponto da conversa" cada cliente está, dentro de um
-- fluxo (como agendamento). É temporário por natureza — serve só
-- para o sistema saber como interpretar a PRÓXIMA mensagem do
-- cliente, e pode ser limpo depois que o fluxo termina.
-- =====================================================================

create table tp_conversation_state (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  company_id bigint not null references tp_companies(id),
  customer_phone text not null,
  step text not null,
  context jsonb default '{}'::jsonb,
  unique (company_id, customer_phone)
);

alter table tp_conversation_state enable row level security;

create policy "service_role tem acesso total - tp_conversation_state"
on tp_conversation_state for all to service_role using (true) with check (true);