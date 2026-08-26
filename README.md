# Projeto Ludus

Sistema de gerenciamento educacional com jogos.

## Executar com Docker (painel + MongoDB + Mongo Express)

Esta configuração sobe o painel administrativo deste repositório, um MongoDB local persistente e o Mongo Express para administrar o banco no navegador.

1. Instale o [Docker Desktop](https://www.docker.com/products/docker-desktop/) e deixe-o em execução.
2. Crie sua configuração local a partir do modelo:

   ```powershell
   Copy-Item .env.docker.example .env.docker
   ```

3. Edite `.env.docker`. Troque todas as senhas, o `SESSION_SECRET` e mantenha a mesma senha em `MONGO_URI`, `ME_CONFIG_MONGODB_URL` e `MONGO_INITDB_ROOT_PASSWORD`.
4. Inicie os serviços:

   ```powershell
   docker compose up --build -d
   ```

5. Acesse:

   - Painel administrativo: http://localhost:3000
   - Interface do banco: http://localhost:3000/database/ (requer login no painel com perfil administrador)

O banco fica no volume Docker `mongo_data`, portanto os dados continuam existindo após `docker compose down`. Para acompanhar os logs, use `docker compose logs -f`. Para parar os serviços, use `docker compose down`.

Defina as credenciais antes da primeira inicialização: o MongoDB só aplica `MONGO_INITDB_ROOT_*` quando o volume está vazio. Para recriar o banco do zero (isso apaga todos os dados), use `docker compose down -v` e suba os serviços novamente.

> O MongoDB fica vinculado a `127.0.0.1` e o Mongo Express não publica porta local: ele só é acessado via `/database/` no painel, após autenticação de sessão e validação de perfil administrador.

### Adicionar o site público

Este repositório contém apenas o painel administrativo. Quando o código do site público estiver em uma pasta como `./site`, adicione outro serviço ao `docker-compose.yml`, com seu próprio Dockerfile, conectado à mesma rede Docker. Ele deve se conectar ao banco usando o host `mongo` (nunca `localhost`) e a URI interna definida em `MONGO_URI`.

## Configuração no Docker

Configure as variáveis no arquivo `.env.docker` da pasta raiz:

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

# Ambiente
NODE_ENV=production

# Tamanho máximo do PDF de artigo em bytes (padrão: 15 MiB)
ARTICLE_PDF_MAX_BYTES=15728640
```

### Configurações MongoDB Atlas

1. Acesse [MongoDB Atlas](https://cloud.mongodb.com)
2. Vá em **Network Access** → Add IP Address
3. Adicione o IP público do VPS que executa o Docker
4. Evite liberar `0.0.0.0/0` quando o IP do VPS puder ser usado

Os uploads dos jogos ficam no volume Docker `games_public`, compartilhado entre o painel e o site.

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
│   └── index.js          # Rotas e aplicação do painel
├── models/               # Modelos MongoDB
├── views/                # Templates EJS
├── public/               # Arquivos estáticos
├── server.js             # Servidor do painel
└── Dockerfile            # Imagem Docker do painel
```

## Deploy no VPS

```bash
git pull origin main
docker compose up --build -d
docker compose ps
```

O domínio deve apontar para o VPS, e o proxy reverso deve encaminhar o painel para a porta `3000` e o site para a porta `3001`.

## Solução de Problemas

### Erro de conexão MongoDB
- Verifique se `MONGO_URI` está configurado corretamente
- Confirme que o IP público do VPS está liberado no MongoDB Atlas

### Erro de sessão
- Verifique se `SESSION_SECRET` está configurado
- Confirme que o domínio está usando HTTPS

### Página em branco ou erro 500
- Verifique os logs com `docker compose logs --tail=100 admin site`
- Console.log mostrará erros detalhados

### Login não funciona
- Primeiro acesso: use `/seed-admin` para criar admin
- Verifique se as credenciais estão corretas
- Verifique os logs com `docker compose logs --tail=100 admin`
