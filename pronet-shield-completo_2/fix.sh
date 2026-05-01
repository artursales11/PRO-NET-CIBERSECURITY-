#!/bin/bash
# ============================================================
# Pro Net Shield — Script de Diagnóstico e Correção
# Execute no VPS: bash fix.sh
# ============================================================

set -e
echo ""
echo "═══════════════════════════════════════════════════"
echo "  PRO NET SHIELD — DIAGNÓSTICO E CORREÇÃO"
echo "═══════════════════════════════════════════════════"
echo ""

# ── PROBLEMA 1: Porta 4000 em uso ───────────────────────────
echo "[ 1/5 ] Verificando porta 4000..."
PID=$(lsof -ti:4000 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "  ⚠  Porta 4000 em uso pelo processo PID $PID"
  echo "  → Encerrando processo..."
  kill -9 $PID 2>/dev/null || true
  sleep 1
  echo "  ✓  Porta 4000 liberada"
else
  echo "  ✓  Porta 4000 livre"
fi

# ── PROBLEMA 2: Verificar .env ──────────────────────────────
echo ""
echo "[ 2/5 ] Verificando arquivo .env..."

ENV_FILE="/opt/pronet-shield/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "  ✗  .env não encontrado em $ENV_FILE"
  exit 1
fi

# Verifica variáveis obrigatórias
check_var() {
  local var=$1
  local val=$(grep "^${var}=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
  if [ -z "$val" ] || [[ "$val" == *"SEU"* ]] || [[ "$val" == *"COLE"* ]] || [[ "$val" == *"GERE"* ]]; then
    echo "  ✗  $var → NÃO configurada ou com valor de exemplo"
    return 1
  else
    echo "  ✓  $var → OK (${val:0:20}...)"
    return 0
  fi
}

echo ""
echo "  Variáveis obrigatórias:"
ERRORS=0

check_var "SUPABASE_URL"      || ERRORS=$((ERRORS+1))
check_var "SUPABASE_SERVICE_KEY" || ERRORS=$((ERRORS+1))
check_var "JWT_SECRET"        || ERRORS=$((ERRORS+1))
check_var "JWT_REFRESH_SECRET" || ERRORS=$((ERRORS+1))

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "  ✗  $ERRORS variável(is) com problema — veja instruções abaixo"
fi

# ── PROBLEMA 3: Testar conexão Supabase ─────────────────────
echo ""
echo "[ 3/5 ] Testando conexão com o Supabase..."

SUPABASE_URL=$(grep "^SUPABASE_URL=" "$ENV_FILE" | cut -d'=' -f2-)
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" "$ENV_FILE" | cut -d'=' -f2-)

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ]; then
  echo "  ✗  Variáveis do Supabase não encontradas no .env"
else
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "${SUPABASE_URL}/rest/v1/users?select=id&limit=1" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    --max-time 10 2>/dev/null || echo "000")
  
  if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "404" ]; then
    echo "  ✓  Supabase respondeu (HTTP $HTTP_STATUS) — conexão OK"
  elif [ "$HTTP_STATUS" = "401" ]; then
    echo "  ✗  Supabase retornou 401 — chave inválida"
    echo "     Verifique se está usando a chave SERVICE_ROLE (não a anon)"
  elif [ "$HTTP_STATUS" = "000" ]; then
    echo "  ✗  Supabase não respondeu — verifique SUPABASE_URL"
  else
    echo "  ⚠  Supabase retornou HTTP $HTTP_STATUS"
  fi
fi

# ── PROBLEMA 4: Verificar dependências Node ──────────────────
echo ""
echo "[ 4/5 ] Verificando dependências Node.js..."

cd /opt/pronet-shield/backend

MISSING=""
for pkg in express cors helmet jsonwebtoken bcryptjs zod dotenv express-rate-limit ws node-cron nodemailer @supabase/supabase-js; do
  if [ ! -d "node_modules/$pkg" ] && [ ! -d "node_modules/${pkg%%/*}" ]; then
    MISSING="$MISSING $pkg"
  fi
done

if [ -n "$MISSING" ]; then
  echo "  ⚠  Dependências faltando:$MISSING"
  echo "  → Instalando..."
  npm install --silent
  echo "  ✓  Dependências instaladas"
else
  echo "  ✓  Todas as dependências presentes"
fi

# ── GERA CHAVES JWT SE FALTAREM ─────────────────────────────
echo ""
echo "[ 5/5 ] Verificando chaves JWT..."

JWT_SECRET=$(grep "^JWT_SECRET=" "$ENV_FILE" | cut -d'=' -f2-)
JWT_REFRESH=$(grep "^JWT_REFRESH_SECRET=" "$ENV_FILE" | cut -d'=' -f2-)

NEEDS_UPDATE=0

if [ -z "$JWT_SECRET" ] || [[ "$JWT_SECRET" == *"GERE"* ]] || [[ "$JWT_SECRET" == *"COLE"* ]]; then
  NEW_JWT=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  echo "  → JWT_SECRET gerado automaticamente"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$NEW_JWT|" "$ENV_FILE"
  NEEDS_UPDATE=1
else
  echo "  ✓  JWT_SECRET presente"
fi

if [ -z "$JWT_REFRESH" ] || [[ "$JWT_REFRESH" == *"GERE"* ]] || [[ "$JWT_REFRESH" == *"COLE"* ]]; then
  NEW_REFRESH=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  echo "  → JWT_REFRESH_SECRET gerado automaticamente"
  sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$NEW_REFRESH|" "$ENV_FILE"
  NEEDS_UPDATE=1
else
  echo "  ✓  JWT_REFRESH_SECRET presente"
fi

if [ $NEEDS_UPDATE -eq 1 ]; then
  echo "  ✓  Chaves JWT atualizadas no .env"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  DIAGNÓSTICO CONCLUÍDO"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  Para iniciar o backend:"
echo "  cd /opt/pronet-shield/backend && npm start"
echo ""
