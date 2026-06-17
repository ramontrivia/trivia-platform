-- =====================================================================
-- 003_agendamento_schema.sql
-- Tabelas do molde de AGENDAMENTO (serve salão, clínica, dentista,
-- barbearia, e qualquer cliente futuro do mesmo tipo).
--
-- Vocabulário neutro propositalmente:
--   "provider" (prestador) em vez de "profissional"/"dentista"
--   "service" (serviço) em vez de "corte"/"limpeza"
-- O vocabulário específico de cada negócio mora no knowledge, não aqui.
-- =====================================================================

-- Prestadores (cabeleireira, dentista, barbeiro, etc.)
create table tp_providers (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  company_id bigint not null references tp_companies(id),
  name text not null,
  phone text,
  role text,
  active boolean default true
);

-- Serviços oferecidos (corte, limpeza dental, manicure, etc.)
create table tp_services (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  company_id bigint not null references tp_companies(id),
  name text not null,
  duration_minutes int not null default 60,
  price numeric(10,2)
);

-- Ponte: quais serviços cada prestador realiza
create table tp_provider_services (
  id bigint generated always as identity primary key,
  provider_id bigint not null references tp_providers(id),
  service_id bigint not null references tp_services(id),
  unique (provider_id, service_id)
);

-- Horário de trabalho de cada prestador
create table tp_working_hours (
  id bigint generated always as identity primary key,
  provider_id bigint not null references tp_providers(id),
  day_of_week int not null check (day_of_week between 0 and 6), -- 0 = domingo
  start_time time not null,
  end_time time not null
);

-- Os agendamentos em si
create table tp_appointments (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  company_id bigint not null references tp_companies(id),
  provider_id bigint not null references tp_providers(id),
  service_id bigint not null references tp_services(id),
  customer_phone text not null,
  customer_name text,
  scheduled_at timestamptz not null,
  status text not null default 'aguardando_aprovacao' check (
    status in (
      'aguardando_aprovacao',
      'confirmado',
      'em_atendimento',
      'finalizado',
      'cancelado',
      'remarcado',
      'nao_compareceu'
    )
  )
);

-- Segurança: ativa RLS em todas, e libera acesso total ao backend
alter table tp_providers enable row level security;
alter table tp_services enable row level security;
alter table tp_provider_services enable row level security;
alter table tp_working_hours enable row level security;
alter table tp_appointments enable row level security;

create policy "service_role tem acesso total - tp_providers"
on tp_providers for all to service_role using (true) with check (true);

create policy "service_role tem acesso total - tp_services"
on tp_services for all to service_role using (true) with check (true);

create policy "service_role tem acesso total - tp_provider_services"
on tp_provider_services for all to service_role using (true) with check (true);

create policy "service_role tem acesso total - tp_working_hours"
on tp_working_hours for all to service_role using (true) with check (true);

create policy "service_role tem acesso total - tp_appointments"
on tp_appointments for all to service_role using (true) with check (true);