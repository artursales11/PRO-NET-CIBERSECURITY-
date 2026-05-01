'use strict';
const { createClient } = require('@supabase/supabase-js');
const logger = require('./logger');

let supabase = null;

function getSupabase() {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    logger.error('supabase_config_missing', {
      SUPABASE_URL: url ? 'OK' : 'FALTANDO',
      SUPABASE_SERVICE_KEY: key ? 'OK' : 'FALTANDO',
    });
    return null;
  }

  supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return supabase;
}

// Testa a conexão e loga o resultado
async function testConnection() {
  const db = getSupabase();
  if (!db) {
    console.error('\n❌ SUPABASE NÃO CONFIGURADO');
    console.error('   Verifique o .env:');
    console.error('   SUPABASE_URL=https://xxxx.supabase.co');
    console.error('   SUPABASE_SERVICE_KEY=eyJ... (chave service_role)\n');
    return false;
  }

  const { data, error } = await db.from('users').select('id').limit(1);

  if (error) {
    if (error.code === '42P01') {
      // Tabela não existe — schema não foi aplicado
      console.error('\n❌ TABELAS NÃO ENCONTRADAS NO SUPABASE');
      console.error('   Execute o supabase_schema.sql no SQL Editor do Supabase');
      console.error('   supabase.com → seu projeto → SQL Editor → New Query → Cole o schema\n');
    } else if (error.message?.includes('Invalid API key')) {
      console.error('\n❌ SUPABASE_SERVICE_KEY INVÁLIDA');
      console.error('   Use a chave "service_role" (NÃO a "anon key")');
      console.error('   Supabase → Project Settings → API → service_role\n');
    } else {
      console.error('\n❌ ERRO AO CONECTAR NO SUPABASE:', error.message);
    }
    return false;
  }

  console.log('✅ Supabase conectado com sucesso');
  return true;
}

module.exports = {
  get supabase() { return getSupabase(); },
  testConnection,
};
