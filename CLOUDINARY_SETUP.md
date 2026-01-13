# 📸 Configuração do Cloudinary para Upload de Imagens no Vercel

## Por que Cloudinary?

O Vercel é um ambiente **serverless** onde o sistema de arquivos é temporário e destruído após cada request. Por isso, não é possível salvar imagens localmente como no desenvolvimento. O **Cloudinary** é um serviço gratuito que resolve esse problema hospedando as imagens na nuvem.

## 🔧 Passo a Passo

### 1. Criar Conta no Cloudinary

1. Acesse: https://cloudinary.com
2. Clique em **Sign Up** (criar conta gratuita)
3. Preencha o formulário ou faça login com Google/GitHub
4. Após criar a conta, você será redirecionado para o Dashboard

### 2. Obter as Credenciais

No **Dashboard** do Cloudinary, você verá uma seção chamada **"Product Environment Credentials"**:

```
Cloud Name: seu_cloud_name
API Key: sua_api_key_aqui
API Secret: sua_api_secret_aqui
```

Também há uma URL completa no formato:
```
cloudinary://api_key:api_secret@cloud_name
```

### 3. Configurar no Vercel

No seu projeto no Vercel:

1. Vá em **Settings** → **Environment Variables**
2. Adicione as seguintes variáveis:

```
CLOUDINARY_CLOUD_NAME = seu_cloud_name
CLOUDINARY_API_KEY = sua_api_key
CLOUDINARY_API_SECRET = sua_api_secret
CLOUDINARY_URL = cloudinary://api_key:api_secret@cloud_name
NODE_ENV = production
```

3. Clique em **Save**
4. Faça um novo **deploy** (pode ser fazendo um novo git push ou no botão "Redeploy" do Vercel)

### 4. Testar

Após o deploy:

1. Acesse seu site no Vercel
2. Faça login como admin
3. Vá em **Mapeamento de Jogos**
4. Tente cadastrar um jogo com uma imagem
5. A imagem deve aparecer na tabela! 🎉

## 🧪 Como Funciona

- **Em desenvolvimento (localhost)**: As imagens são salvas em `public/uploads/`
- **Em produção (Vercel)**: As imagens são enviadas para o Cloudinary e o código salva a URL da CDN no banco de dados

## ⚠️ Importante

- O plano gratuito do Cloudinary permite até **25 GB de armazenamento** e **25 GB de bandwidth por mês** - mais que suficiente!
- As imagens ficam armazenadas permanentemente no Cloudinary
- A URL da imagem será algo como: `https://res.cloudinary.com/seu_cloud_name/image/upload/v123456789/ludus-jogos/jogo-123456.png`

## 🔍 Verificar se está funcionando

Após fazer upload, abra o **Console do navegador** (F12) e verifique:
- A resposta da API deve conter `icone_url` com uma URL do Cloudinary
- Se aparecer erro, verifique se as variáveis de ambiente estão corretas no Vercel

## 📦 Alternativas

Se preferir outro serviço ao invés do Cloudinary:
- **AWS S3** (mais complexo de configurar)
- **UploadCare** (também tem plano gratuito)
- **Imgix** (otimização de imagens)

Mas o Cloudinary é o mais simples e já está implementado! ✅
