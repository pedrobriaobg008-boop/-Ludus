# Projeto Ludus

Sistema de gerenciamento educacional com jogos.

## Configuração no Vercel

### Variáveis de Ambiente Obrigatórias

Configure estas variáveis no painel do Vercel (Settings → Environment Variables):

```env
# MongoDB Atlas (obrigatório)
MONGO_URI=mongodb+srv://usuario:senha@cluster.mongodb.net/ludus?retryWrites=true&w=majority

# Sessão (obrigatório - use uma string aleatória forte)
SESSION_SECRET=sua_chave_secreta_aleatoria_aqui_minimo_32_caracteres

# Admin padrão (recomendado)
ADMIN_EMAIL=admin@ludus.local
ADMIN_PASSWORD=sua_senha_admin_aqui
ADMIN_NAME=Administrador
ADMIN_INSTITUICAO=Ludus

# Token para seed do admin (proteção)
ADMIN_SEED_TOKEN=seu_token_secreto_aqui

# Ambiente (automático no Vercel)
NODE_ENV=production
```

### Configurações MongoDB Atlas

1. Acesse [MongoDB Atlas](https://cloud.mongodb.com)
2. Vá em **Network Access** → Add IP Address
3. Adicione `0.0.0.0/0` (permite todos os IPs - necessário para Vercel)
4. Ou adicione os IPs específicos do Vercel se preferir mais segurança

### Limitações no Vercel (Serverless)

⚠️ **Uploads de imagens**: 
- Em produção, uploads são armazenados em memória (temporário)
- Para persistência, use serviços externos como:
  - Cloudinary
  - AWS S3
  - Vercel Blob Storage

⚠️ **Sessões**:
- Sessões em memória funcionam mas podem ser perdidas
- Para produção robusta, considere usar:
  - Redis (com Upstash)
  - MongoDB session store

## Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Criar arquivo .env baseado no .env.example
cp .env.example .env

# Editar .env com suas configurações locais

# Iniciar servidor
node index.js
```

Acesse: http://localhost:3000

## Estrutura do Projeto

```
├── api/
│   └── index.js          # Handler para Vercel
├── models/               # Modelos MongoDB
├── views/                # Templates EJS
├── public/               # Arquivos estáticos
├── index.js              # Servidor local
└── vercel.json           # Configuração Vercel
```

## Deploy

```bash
git add .
git commit -m "sua mensagem"
git push origin main
```

O Vercel fará o deploy automaticamente.

## Solução de Problemas

### Erro de conexão MongoDB
- Verifique se `MONGO_URI` está configurado corretamente
- Confirme que o IP `0.0.0.0/0` está liberado no MongoDB Atlas

### Erro de sessão
- Verifique se `SESSION_SECRET` está configurado
- Em produção, os cookies precisam de HTTPS (automático no Vercel)

### Página em branco ou erro 500
- Verifique os logs no Vercel Dashboard
- Console.log mostrará erros detalhados

### Login não funciona
- Primeiro acesso: use `/seed-admin` para criar admin
- Verifique se as credenciais estão corretas
- Verifique logs do Vercel para ver mensagens de erro
