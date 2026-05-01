# PRO NET SHIELD — ROTEIRO COMPLETO DE IMPLEMENTAÇÃO
## Do zero até produção, passo a passo

---

## VISÃO GERAL DO QUE VAMOS CONSTRUIR

```
pro-net-shield/
├── backend/          ← Node.js + Express + Supabase + JWT
│   ├── src/
│   │   ├── auth/     ← Login, registro, refresh token, bcrypt
│   │   ├── users/    ← Perfil, planos
│   │   ├── projects/ ← Clientes e sites monitorados
│   │   ├── scans/    ← Scanner real: SSL, headers, portas
│   │   ├── logs/     ← Eventos de segurança, alertas
│   │   ├── middleware/← JWT auth, rate limit, sanitização
│   │   └── utils/    ← DB, logger, IA, alertas
│   ├── .env
│   └── package.json
└── frontend/         ← Dashboard HTML/CSS/JS
    └── index.html    ← Painel completo (já criado)
```

---

## FASE 1 — CONTAS E SERVIDOR (1 hora)

### PASSO 1 — Criar conta no Supabase (banco de dados)

1. Acesse https://supabase.com
2. Clique em "Start your project" → entre com GitHub ou email
3. Crie um novo projeto:
   - Nome: `pronet-shield`
   - Senha do banco: anote em lugar seguro
   - Região: South America (São Paulo)
4. Aguarde ~2 minutos para provisionar

5. Vá em: **Project Settings → API**
   - Copie: `Project URL` → isso é o SUPABASE_URL
   - Copie: `service_role` key → isso é o SUPABASE_SERVICE_KEY
   ⚠️ NÃO use a `anon` key no backend — use sempre a `service_role`

6. Vá em: **SQL Editor → New Query**
   - Cole o conteúdo de `supabase_schema.sql` (arquivo que criamos)
   - Clique em "Run"
   - Todas as tabelas serão criadas automaticamente

---

### PASSO 2 — Contratar VPS (servidor)

Opções recomendadas por custo-benefício:

| Provedor     | Plano         | Preço     | Link                        |
|-------------|---------------|-----------|------------------------------|
| DigitalOcean | Basic 1GB RAM | $6/mês    | digitalocean.com             |
| Vultr        | Cloud Compute | $6/mês    | vultr.com                    |
| Hetzner      | CX11          | €4/mês    | hetzner.com (melhor custo)  |
| Hostinger    | VPS Básico    | R$30/mês  | hostinger.com.br             |

- Sistema operacional: **Ubuntu 22.04 LTS**
- Mínimo: 1 vCPU, 1GB RAM, 25GB SSD

Após criar, anote o IP público do servidor.

---

### PASSO 3 — Acessar o servidor pela primeira vez

No seu computador (terminal / PowerShell):
```bash
ssh root@SEU-IP-DO-VPS
```

Se for a primeira vez, aceite o fingerprint digitando `yes`.

---

## FASE 2 — CONFIGURAR O SERVIDOR (30 minutos)

### PASSO 4 — Instalar Node.js 20 LTS

```bash
# Atualiza o sistema
apt update && apt upgrade -y

# Instala Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Verifica
node -v   # deve mostrar v20.x.x
npm -v    # deve mostrar 10.x.x
```

---

### PASSO 5 — Instalar ferramentas de segurança

```bash
# UFW (firewall)
apt install -y ufw

# Configura UFW
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
ufw --force enable

# fail2ban (bloqueio automático de IPs)
apt install -y fail2ban

# Configuração básica do fail2ban
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled  = true
port     = ssh
logpath  = /var/log/auth.log
maxretry = 3
EOF

systemctl enable fail2ban
systemctl restart fail2ban

# Verifica
fail2ban-client status
```

---

### PASSO 6 — Instalar Apache (se quiser monitorar logs HTTP)

```bash
apt install -y apache2

# Verifica
systemctl status apache2
# Acesse http://SEU-IP — deve aparecer a página padrão do Apache
```

---

### PASSO 7 — Criar usuário para rodar o backend (segurança)

```bash
# Cria usuário sem sudo
adduser --disabled-password --gecos "" shield

# Cria pasta do projeto
mkdir -p /opt/pronet-shield
chown -R shield:shield /opt/pronet-shield
```

---

## FASE 3 — SUBIR O BACKEND (45 minutos)

### PASSO 8 — Copiar os arquivos para o servidor

Do seu computador local:
```bash
# Copia toda a pasta backend para o servidor
scp -r ./backend root@SEU-IP:/opt/pronet-shield/

# Ou usando rsync (mais rápido para muitos arquivos)
rsync -avz ./backend root@SEU-IP:/opt/pronet-shield/
```

---

### PASSO 9 — Configurar as variáveis de ambiente

No servidor:
```bash
cd /opt/pronet-shield/backend

# Cria o .env a partir do exemplo
cp .env.example .env

# Abre para editar
nano .env
```

Preencha cada variável:
```env
PORT=4000
NODE_ENV=production

# Gera a chave JWT — rode esse comando e cole o resultado:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=COLE_AQUI_O_RESULTADO_DO_COMANDO_ACIMA
JWT_REFRESH_SECRET=COLE_AQUI_OUTRO_RESULTADO

# Supabase (copiado do Passo 1)
SUPABASE_URL=https://SEU_ID.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Email (para alertas) — use Gmail com senha de app
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seuemail@gmail.com
SMTP_PASS=sua_senha_de_app
ALERT_EMAIL=seuemail@gmail.com

# Discord (opcional mas recomendado)
DISCORD_WEBHOOK=https://discord.com/api/webhooks/...

# IA Anthropic (opcional — explica vulnerabilidades em português)
ANTHROPIC_API_KEY=sk-ant-...
```

Salva: `Ctrl+X → Y → Enter`

---

### PASSO 10 — Instalar dependências e testar

```bash
cd /opt/pronet-shield/backend

# Instala as dependências
npm install

# Testa se inicia sem erros
node src/server.js

# Deve aparecer:
# [SHIELD] Backend rodando em http://localhost:4000
# [DB] Conectado ao Supabase
```

Se aparecer erro de módulo não encontrado, instale manualmente:
```bash
npm install express cors helmet jsonwebtoken bcryptjs \
  zod dotenv express-rate-limit ws node-cron \
  nodemailer @supabase/supabase-js axios
```

---

### PASSO 11 — Configurar como serviço (reinicia automático)

```bash
# Cria o serviço systemd
cat > /etc/systemd/system/pronet-shield.service << 'EOF'
[Unit]
Description=Pro Net Shield Backend
After=network.target

[Service]
Type=simple
User=shield
WorkingDirectory=/opt/pronet-shield/backend
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Ativa e inicia
systemctl daemon-reload
systemctl enable pronet-shield
systemctl start pronet-shield

# Verifica se está rodando
systemctl status pronet-shield

# Ver logs em tempo real
journalctl -u pronet-shield -f
```

---

## FASE 4 — DOMÍNIO E HTTPS (1 hora)

### PASSO 12 — Apontar domínio para o servidor

No painel do seu registrador de domínio (Hostinger, GoDaddy, Registro.br):

| Tipo | Nome          | Valor       |
|------|---------------|-------------|
| A    | shield        | SEU-IP-VPS  |
| A    | @             | SEU-IP-VPS  |

Aguarde até 10 minutos para propagar.

Teste: `ping shield.seudominio.com.br`

---

### PASSO 13 — Instalar Nginx como proxy reverso

```bash
apt install -y nginx

cat > /etc/nginx/sites-available/pronet-shield << 'EOF'
server {
    listen 80;
    server_name shield.seudominio.com.br;

    location / {
        proxy_pass         http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -s /etc/nginx/sites-available/pronet-shield /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

---

### PASSO 14 — Instalar certificado SSL gratuito (HTTPS)

```bash
apt install -y certbot python3-certbot-nginx

certbot --nginx -d shield.seudominio.com.br

# Siga as instruções:
# - Email: seu email
# - Aceitar termos: A
# - Compartilhar email: N (opcional)

# Renovação automática já é configurada. Teste:
certbot renew --dry-run
```

Seu painel agora está em: `https://shield.seudominio.com.br` ✅

---

## FASE 5 — CONFIGURAR DISCORD (30 minutos)

### PASSO 15 — Criar servidor Discord para alertas

1. No Discord, clique no `+` para criar servidor
2. Nome: `Pro Net Shield — Alertas`
3. Crie os canais:
   - `#alertas-críticos`
   - `#alertas-gerais`
   - `#scan-resultados`
   - `#clientes`

### PASSO 16 — Configurar webhook

1. Clique com botão direito em `#alertas-gerais`
2. **Editar Canal → Integrações → Webhooks → Novo Webhook**
3. Nome: `Shield Bot`
4. Clique em `Copiar URL do Webhook`
5. Cole no `.env`:
   ```
   DISCORD_WEBHOOK=https://discord.com/api/webhooks/ID/TOKEN
   ```
6. Reinicia o backend:
   ```bash
   systemctl restart pronet-shield
   ```

---

## FASE 6 — CONFIGURAR EMAIL (20 minutos)

### PASSO 17 — Gerar senha de app no Gmail

1. Acesse: myaccount.google.com
2. Segurança → Verificação em duas etapas (ative se não tiver)
3. Segurança → Senhas de app
4. Selecione: `Email` + `Outro (nome personalizado)` → `Pro Net Shield`
5. Copie a senha gerada (16 caracteres)
6. Cole no `.env`:
   ```
   SMTP_PASS=xxxx xxxx xxxx xxxx
   ```
7. Reinicia: `systemctl restart pronet-shield`

---

## FASE 7 — TESTAR TUDO (30 minutos)

### PASSO 18 — Testar a API

```bash
# Registrar conta de teste
curl -X POST https://shield.seudominio.com.br/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Teste Admin",
    "email": "admin@pronet.sh",
    "password": "Admin@123",
    "plan": "enterprise"
  }'

# Resposta esperada:
# { "user": {...}, "access_token": "eyJ...", "refresh_token": "eyJ..." }

# Login
curl -X POST https://shield.seudominio.com.br/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@pronet.sh","password":"Admin@123"}'
```

### PASSO 19 — Criar primeiro projeto (cliente)

```bash
# Substitua TOKEN pelo access_token do login
curl -X POST https://shield.seudominio.com.br/api/projects \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Site Principal",
    "target_url": "https://seusite.com.br",
    "target_host": "seusite.com.br",
    "description": "Monitoramento principal"
  }'
```

### PASSO 20 — Rodar primeiro scan real

```bash
# Substitua PROJECT_ID pelo id retornado no passo anterior
curl -X POST https://shield.seudominio.com.br/api/scans \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project_id": "PROJECT_ID"}'

# Aguarde ~30 segundos e consulte o resultado:
curl https://shield.seudominio.com.br/api/scans?project_id=PROJECT_ID \
  -H "Authorization: Bearer TOKEN"
```

---

## FASE 8 — PAINEL FRONTEND

### PASSO 21 — Configurar o frontend

O arquivo `frontend/index.html` é uma SPA completa — não precisa de build.

1. Abra `https://shield.seudominio.com.br` no navegador
2. Use as credenciais criadas no Passo 18
3. Após login, clique em ⚙ se precisar mudar a URL do backend

O backend já serve o frontend automaticamente — o nginx direciona tudo para o Node.js.

---

## FASE 9 — MONITORAMENTO AUTOMÁTICO

### PASSO 22 — Agendar scans automáticos (cron no servidor)

```bash
# Edita o crontab do usuário shield
crontab -u shield -e

# Adiciona as linhas (substitua TOKEN e PROJECT_ID):
# Scan diário às 7h
0 7 * * * curl -s -X POST http://localhost:4000/api/scans \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"PROJECT_ID"}' >> /var/log/shield-cron.log 2>&1

# Relatório mensal no dia 1 às 8h
0 8 1 * * curl -s -X POST http://localhost:4000/api/reports/generate \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"monthly"}' >> /var/log/shield-cron.log 2>&1
```

---

## RESUMO: O QUE CADA ARQUIVO FAZ

| Arquivo                        | Função                                               |
|-------------------------------|------------------------------------------------------|
| `supabase_schema.sql`         | Cria todas as tabelas no Supabase                    |
| `src/server.js`               | Servidor principal — registra todas as rotas         |
| `src/auth/auth.routes.js`     | Login, registro, JWT, refresh token, bcrypt          |
| `src/middleware/auth.js`      | Valida JWT em toda rota protegida                    |
| `src/middleware/security.js`  | Rate limit, sanitização XSS/SQLi, headers            |
| `src/projects/projects.routes.js` | CRUD de projetos/clientes                        |
| `src/scans/scanner.js`        | Scan real: SSL, headers HTTP, portas, uptime         |
| `src/scans/scans.routes.js`   | API que dispara e consulta scans                     |
| `src/logs/logs.routes.js`     | Alertas, eventos de segurança, audit log             |
| `src/utils/db.js`             | Conexão com o Supabase                               |
| `src/utils/ai.js`             | Gera explicação das vulnerabilidades com Claude      |
| `src/utils/alerts.js`         | Envia alertas: Discord + Email + Dashboard           |
| `src/utils/logger.js`         | Log centralizado com persistência no banco           |
| `frontend/index.html`         | Painel completo — login real, JWT, todas as telas    |

---

## CHECKLIST FINAL

Antes de abrir para clientes:

- [ ] Supabase criado e schema aplicado
- [ ] VPS rodando Ubuntu 22.04
- [ ] Node.js 20 instalado
- [ ] UFW configurado e ativo
- [ ] fail2ban configurado e ativo
- [ ] `.env` preenchido com todas as variáveis
- [ ] Backend iniciando sem erros
- [ ] systemd service configurado (reinicia automático)
- [ ] Nginx configurado como proxy
- [ ] HTTPS com Certbot funcionando
- [ ] Discord webhook funcionando (teste enviando alerta)
- [ ] Email SMTP funcionando (teste enviando alerta)
- [ ] Primeiro scan real rodado com sucesso
- [ ] Cron de scan automático agendado
- [ ] Frontend acessível em https://shield.seudominio.com.br

---

## CUSTO MENSAL ESTIMADO

| Item              | Valor         |
|-------------------|---------------|
| VPS (Hetzner CX11)| ~R$ 25/mês    |
| Domínio .com.br   | ~R$ 40/ano    |
| Supabase          | Gratuito até 500MB |
| Discord           | Gratuito      |
| Gmail SMTP        | Gratuito      |
| **TOTAL**         | **~R$ 25/mês** |

---

## PRÓXIMOS PASSOS APÓS FUNCIONANDO

1. Cadastrar primeiros clientes reais no painel
2. Rodar scan nos sites dos clientes
3. Gerar relatório PDF e enviar por email
4. Configurar scan diário automático para cada cliente
5. Montar proposta comercial com print do painel mostrando score real do site do cliente

---

*Pro Net Programação — pronetprogramacao.com.br*
*WhatsApp: (85) 99233-9925*
*Discord: discord.gg/Xudz6a9Yjb*
