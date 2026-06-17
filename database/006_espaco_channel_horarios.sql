-- =====================================================================
-- 006_espaco_channel_horarios.sql
-- Horário de trabalho do Espaço Channel: terça a sábado, 9h às 18h,
-- aplicado a todas as profissionais.
-- =====================================================================

insert into tp_working_hours (provider_id, day_of_week, start_time, end_time)
select p.id, dia, '09:00', '18:00'
from tp_providers p
cross join (values (2), (3), (4), (5), (6)) as dias(dia)
where p.company_id = 1;