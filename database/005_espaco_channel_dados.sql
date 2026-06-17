insert into tp_providers (company_id, name, phone, role, active) values
(1, 'Fernanda', 'telefone_provisorio_fernanda', 'maquiadora_cabeleireira', true),
(1, 'Natalia', 'telefone_provisorio_natalia', 'cabeleireira_gerente', true),
(1, 'Fabiana', 'telefone_provisorio_fabiana', 'manicure', true),
(1, 'Priscila', 'telefone_provisorio_priscila', 'manicure', true),
(1, 'Vitoria', 'telefone_provisorio_vitoria', 'cabeleireira_secretaria', true),
(1, 'Camila', 'telefone_provisorio_camila', 'cabeleireira', true),
(1, 'Naira', 'telefone_provisorio_naira', 'estetica_depilacao', true);

insert into tp_services (company_id, name, duration_minutes) values
(1, 'Coloracao', 40),
(1, 'Mechas', 360),
(1, 'Progressiva', 180),
(1, 'Tratamento Capilar', 60),
(1, 'Botox', 180),
(1, 'Selagem', 180),
(1, 'Prime Liss', 180),
(1, 'Corte', 30),
(1, 'Penteado', 90),
(1, 'Escova', 60),
(1, 'Pe', 50),
(1, 'Mao', 50),
(1, 'Pe e Mao', 90),
(1, 'Sobrancelha', 30),
(1, 'Buco', 20),
(1, 'Virilha', 40),
(1, 'Perna', 40),
(1, 'Facial', 120),
(1, 'Corporal', 120),
(1, 'Maquiagem', 90);

insert into tp_provider_services (provider_id, service_id)
select p.id, s.id
from tp_providers p
join tp_services s on true
where p.company_id = 1 and s.company_id = 1
and (
  (p.name in ('Fernanda', 'Natalia', 'Vitoria', 'Camila')
   and s.name in ('Coloracao', 'Mechas', 'Progressiva', 'Tratamento Capilar', 'Botox', 'Selagem', 'Prime Liss', 'Corte', 'Penteado', 'Escova'))
  or
  (p.name in ('Fabiana', 'Priscila')
   and s.name in ('Pe', 'Mao', 'Pe e Mao'))
  or
  (p.name = 'Naira'
   and s.name in ('Sobrancelha', 'Buco', 'Virilha', 'Perna', 'Facial', 'Corporal'))
  or
  (p.name = 'Fernanda'
   and s.name = 'Maquiagem')
);