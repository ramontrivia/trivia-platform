// =====================================================================
// companies.js
// Tudo relacionado à tabela "tp_companies" no Supabase.
//
// Este arquivo é FIXO — a forma de buscar uma empresa é igual para
// todos os clientes. O que muda (nome, telefone, business_type) são
// só os DADOS guardados no banco, não a lógica aqui.
// =====================================================================

import { supabase } from "./supabase.js";

/**
 * Busca a empresa dona de um determinado phone_number_id
 * (o número de WhatsApp que recebeu a mensagem).
 *
 * @param {string} phoneNumberId
 * @returns {object|null} a empresa encontrada, ou null se não existir
 */
export async function getCompanyByPhoneNumberId(phoneNumberId) {
  const { data, error } = await supabase
    .from("tp_companies")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .single();

  if (error) {
    console.error("Erro ao buscar empresa por phone_number_id:", error.message);
    return null;
  }

  return data;
}

/**
 * Busca uma empresa pelo seu ID interno.
 * Útil quando já temos o ID (ex: vindo de um agendamento) e
 * precisamos dos dados completos da empresa.
 *
 * @param {number} companyId
 * @returns {object|null}
 */
export async function getCompanyById(companyId) {
  const { data, error } = await supabase
    .from("tp_companies")
    .select("*")
    .eq("id", companyId)
    .single();

  if (error) {
    console.error("Erro ao buscar empresa por id:", error.message);
    return null;
  }

  return data;
}