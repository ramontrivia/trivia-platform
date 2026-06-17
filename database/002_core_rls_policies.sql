-- =====================================================================
-- 002_core_rls_policies.sql
-- Permite que o backend (chave service_role) tenha acesso total
-- às tabelas centrais. Isso é seguro porque a service_role key
-- nunca é exposta publicamente — só existe nas variáveis de
-- ambiente do Railway, dentro do nosso código.
-- =====================================================================

create policy "service_role tem acesso total - tp_companies"
on tp_companies for all
to service_role
using (true)
with check (true);

create policy "service_role tem acesso total - tp_leads"
on tp_leads for all
to service_role
using (true)
with check (true);

create policy "service_role tem acesso total - tp_lead_interactions"
on tp_lead_interactions for all
to service_role
using (true)
with check (true);