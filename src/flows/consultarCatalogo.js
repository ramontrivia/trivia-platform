import { supabase } from "../services/supabase.js";

// Lista os servicos da empresa, excluindo terceirizados
export async function listarServicos(companyId) {
  const { data: services } = await supabase
    .from("tp_services")
    .select("name")
    .eq("company_id", companyId)
    .eq("terceirizado", false)
    .order("name");
  if (!services || services.length === 0) return [];
  return services.map((s) => s.name);
}

// Lista os profissionais ativos da empresa
export async function listarProfissionais(companyId) {
  const { data: providers } = await supabase
    .from("tp_providers")
    .select("name, role")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("name");
  if (!providers || providers.length === 0) return [];
  return providers.map((p) => ({ name: p.name, role: p.role }));
}