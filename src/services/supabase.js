// =====================================================================
// supabase.js
// Conexão ÚNICA e centralizada com o Supabase.
//
// Todos os outros arquivos que precisam falar com o banco devem
// importar o "supabase" daqui, em vez de criar sua própria conexão.
// Isso facilita trocar configurações no futuro (um lugar só para mudar).
// =====================================================================

import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);