import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join, normalize, relative, sep } from 'path';
import { mkdir, mkdtemp, rename, rm, stat } from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import http from 'http';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import unzipper from 'unzipper';
import dotenv from 'dotenv';
import session from 'cookie-session';

// Caminho correto das views e public
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Models
import Usuario from '../models/Usuario.js';
import Jogo from '../models/Jogo.js';
import Turma from '../models/Turma.js';
import Jogador from '../models/Jogador.js';
import Categoria from '../models/Categoria.js';
import ConteudoRelacionado from '../models/ConteudoRelacionado.js';

// GridFS
// Nota: migração para armazenamento em documento (Buffer). GridFS removido.

dotenv.config({ override: true, path: join(__dirname, '../.env') });

const app = express();

// Necessário para que cookies "secure" funcionem atrás do proxy HTTPS do domínio.
app.set('trust proxy', 1);

// O Mongo Express recebe requisições via proxy abaixo. Não consuma seu corpo
// aqui, pois ele precisa ser encaminhado intacto (inclusive em formulários).
const urlencodedParser = express.urlencoded({ extended: true });
const jsonParser = express.json();
app.use((req, res, next) => (req.path.startsWith('/database') ? next() : urlencodedParser(req, res, next)));
app.use((req, res, next) => (req.path.startsWith('/database') ? next() : jsonParser(req, res, next)));
app.set('view engine', 'ejs');

// Servir arquivos estáticos
app.use(express.static(join(__dirname, '../public')));
app.set('views', join(__dirname, '../views'));

// Em desenvolvimento local, o painel usa HTTP. Em produção, o padrão segue
// sendo HTTPS, exceto se COOKIE_SECURE for definido explicitamente.
const useSecureCookies = process.env.COOKIE_SECURE === 'true'
  || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false');

// Sessões baseadas em cookie (compatível com serverless)
app.use(
  session({
    name: 'sid',
    keys: [process.env.SESSION_SECRET || 'dev-secret'],
    httpOnly: true,
    secure: useSecureCookies,
    sameSite: useSecureCookies ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
);

// Storages em memória para enviar direto ao GridFS
const imageStorage = multer.memoryStorage();
const pdfStorage = multer.memoryStorage();

const imageFileFilter = (_req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Apenas imagens são permitidas'), false);
};

const pdfFileFilter = (_req, file, cb) => {
  if (file.mimetype === 'application/pdf') return cb(null, true);
  cb(new Error('Apenas arquivos PDF são permitidos'), false);
};

const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

const uploadPdf = multer({
  storage: pdfStorage,
  fileFilter: pdfFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

const GAME_ARCHIVE_MAX_BYTES = Number(process.env.GAME_ARCHIVE_MAX_BYTES || 200 * 1024 * 1024);
const GAME_ARCHIVE_MAX_FILES = Number(process.env.GAME_ARCHIVE_MAX_FILES || 5000);
const GAME_ARCHIVE_MAX_UNCOMPRESSED_BYTES = Number(process.env.GAME_ARCHIVE_MAX_UNCOMPRESSED_BYTES || 500 * 1024 * 1024);
const gamePublicDir = process.env.GAME_PUBLIC_DIR || join(__dirname, '../public/jogos-publicados');

const isZipFile = (file) => file.mimetype === 'application/zip'
  || file.mimetype === 'application/x-zip-compressed'
  || /\.zip$/i.test(file.originalname || '');
const gameUploadFilter = (_req, file, cb) => {
  if (file.fieldname === 'icone') return imageFileFilter(_req, file, cb);
  if (file.fieldname === 'arquivo_jogo' && isZipFile(file)) return cb(null, true);
  cb(new Error('Envie uma imagem no campo ícone e um arquivo ZIP no campo do jogo'), false);
};
const uploadGame = multer({ storage: multer.memoryStorage(), fileFilter: gameUploadFilter, limits: { fileSize: GAME_ARCHIVE_MAX_BYTES, files: 2 } }).fields([
  { name: 'icone', maxCount: 1 }, { name: 'arquivo_jogo', maxCount: 1 }
]);
const getUploadedFile = (req, fieldName) => req.files?.[fieldName]?.[0];
const slugify = (value) => String(value || 'jogo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'jogo';
const isPrivateIp = (address) => {
  if (address === '::1' || address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true;
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};
async function validateGameSourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Informe uma URL válida para o arquivo do jogo'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('A URL deve usar HTTP(S), sem credenciais');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error('URLs internas ou locais não são permitidas');
  return url;
}
async function downloadGameArchive(sourceUrl) {
  let url = await validateGameSourceUrl(sourceUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new Error('A URL excedeu o limite de redirecionamentos');
      url = await validateGameSourceUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Não foi possível baixar o arquivo (HTTP ${response.status})`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length && length > GAME_ARCHIVE_MAX_BYTES) throw new Error('O arquivo do jogo excede o limite permitido');
    const reader = response.body.getReader(); const chunks = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > GAME_ARCHIVE_MAX_BYTES) throw new Error('O arquivo do jogo excede o limite permitido');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Não foi possível baixar o arquivo');
}
async function publishGameArchive(buffer, gameName, gameId) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('O arquivo informado não é um ZIP válido');
  const archive = await unzipper.Open.buffer(buffer);
  if (!archive.files.length || archive.files.length > GAME_ARCHIVE_MAX_FILES) throw new Error('O ZIP possui uma quantidade inválida de arquivos');
  let uncompressedSize = 0;
  // O diretório temporário precisa ficar no mesmo volume do destino. Em Docker,
  // /tmp e o volume de jogos são sistemas de arquivos distintos (EXDEV no rename).
  await mkdir(gamePublicDir, { recursive: true });
  const tempRoot = await mkdtemp(join(gamePublicDir, '.upload-'));
  const extractedRoot = join(tempRoot, 'conteudo');
  const destinationName = `${slugify(gameName)}-${String(gameId)}`;
  const destination = join(gamePublicDir, destinationName);
  const htmlFiles = [];
  try {
    await mkdir(extractedRoot, { recursive: true });
    for (const entry of archive.files) {
      const entryPath = entry.path.replace(/\\/g, '/');
      const outputPath = normalize(join(extractedRoot, entryPath));
      if (!entryPath || entryPath.startsWith('/') || entryPath.includes('\0') || relative(extractedRoot, outputPath).startsWith('..') || relative(extractedRoot, outputPath).includes(`${sep}..${sep}`)) throw new Error('O ZIP contém um caminho de arquivo inválido');
      if (entry.type === 'Directory') { await mkdir(outputPath, { recursive: true }); continue; }
      if (entry.type !== 'File' || ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw new Error('O ZIP contém um tipo de arquivo não permitido');
      uncompressedSize += entry.uncompressedSize || 0;
      if (uncompressedSize > GAME_ARCHIVE_MAX_UNCOMPRESSED_BYTES) throw new Error('O conteúdo descompactado excede o limite permitido');
      await mkdir(dirname(outputPath), { recursive: true });
      await pipeline(entry.stream(), createWriteStream(outputPath, { flags: 'wx' }));
      if (/^index\.html?$/i.test(entryPath) || /\/index\.html?$/i.test(entryPath)) htmlFiles.push(entryPath);
    }
    if (!htmlFiles.length) throw new Error('O ZIP precisa conter um arquivo index.html');
    const indexFile = htmlFiles.sort((a, b) => a.length - b.length)[0];
    const backup = `${destination}.backup-${Date.now()}`; let hasBackup = false;
    try { await stat(destination); await rename(destination, backup); hasBackup = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(extractedRoot, destination); if (hasBackup) await rm(backup, { recursive: true, force: true }); }
    catch (error) { if (hasBackup) await rename(backup, destination).catch(() => {}); throw error; }
    return `/jogos-publicados/${encodeURIComponent(destinationName)}/${indexFile.split('/').map(encodeURIComponent).join('/')}`;
  } finally { await rm(tempRoot, { recursive: true, force: true }).catch(() => {}); }
}
async function removePublishedGame(publicPath) {
  if (!publicPath || !publicPath.startsWith('/jogos-publicados/')) return;
  const folder = decodeURIComponent(publicPath.slice('/jogos-publicados/'.length).split('/')[0]);
  if (!/^[a-z0-9-]+$/i.test(folder)) return;
  const target = join(gamePublicDir, folder);
  if (relative(gamePublicDir, target).startsWith('..')) return;
  await rm(target, { recursive: true, force: true });
}

// Conectar ao MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ludus';

// Validar MONGO_URI em produção
if (process.env.NODE_ENV === 'production' && !process.env.MONGO_URI) {
  console.error('❌ ERRO: MONGO_URI não configurado no servidor!');
  console.error('Configure a variável MONGO_URI no ambiente do Docker.');
}

let isConnected = false;

const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  if (process.env.NODE_ENV === 'production' && !process.env.MONGO_URI) {
    throw new Error('MONGO_URI não configurado. Configure a variável no ambiente do Docker.');
  }

  try {
    console.log('Conectando ao MongoDB...');
    await mongoose.connect(MONGO_URI, { 
      useNewUrlParser: true, 
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      dbName: 'ludus'
    });
    isConnected = true;
    const dbName = mongoose.connection.name;
    const dbHost = mongoose.connection.host;
    console.log(`✅ MongoDB conectado: ${dbHost}/${dbName}`);
  } catch (err) {
    console.error('❌ Erro ao conectar MongoDB:', err.message);
    isConnected = false;
    throw err;
  }
};

// Chamar conexão inicial
connectDB();

// Garantir admin existente
async function ensureAdmin() {
  try {
    await connectDB();
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@ludus.local').toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminNome = process.env.ADMIN_NAME || 'Administrador';
    const instituicao = process.env.ADMIN_INSTITUICAO || 'Ludus';
    const exists = await Usuario.findOne({ email_usuario: adminEmail });
    if (exists) {
      console.log('Admin existente:', adminEmail);
      return;
    }
    const hash = await bcrypt.hash(adminPassword, 10);
    await Usuario.create({
      nome_usuario: adminNome,
      email_usuario: adminEmail,
      senha_hash: hash,
      instituicao_usuario: instituicao,
      perfil: ['Administrador']
    });
    console.log('Admin criado:', adminEmail);
  } catch (e) {
    console.error('Falha ao garantir admin:', e);
  }
}
ensureAdmin();

// Helper para checar se é admin (aceita string ou array, e variações)
const isAdminPerfil = (perfil) => {
  const normalize = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
  const admins = new Set(['admin', 'administrador', 'adm']);
  if (Array.isArray(perfil)) {
    return perfil.some((p) => admins.has(normalize(p)));
  }
  if (typeof perfil === 'string') {
    return admins.has(normalize(perfil));
  }
  return false;
};

// Expor usuário atual às views
app.use((req, res, next) => {
  const user = req.session?.user || null;
  res.locals.currentUser = user;
  res.locals.isAdmin = isAdminPerfil(user?.perfil);
  next();
});

// Middlewares de autenticação/autorização
const requireAuthView = (req, res, next) => {
  if (!req.session?.user) return res.redirect('/');
  next();
};

const requireAuthApi = (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Não autenticado' });
  next();
};

const requireAdmin = (req, res, next) => {
  const user = req.session?.user;
  if (!user || !isAdminPerfil(user.perfil)) {
    return req.originalUrl.startsWith('/api')
      ? res.status(403).json({ error: 'Acesso negado' })
      : res.redirect('/');
  }
  next();
};

// O Mongo Express não conhece os usuários do Ludus: ele só suporta um login
// Basic estático. Este proxy usa a sessão do painel e só encaminha usuários
// administradores, mantendo as credenciais técnicas dentro da rede Docker.
const proxyMongoExpress = (req, res, next) => {
  const username = process.env.ME_CONFIG_BASICAUTH_USERNAME;
  const password = process.env.ME_CONFIG_BASICAUTH_PASSWORD;
  if (!username || !password) {
    return res.status(503).send('A interface do banco não está configurada.');
  }

  const upstream = http.request({
    hostname: process.env.MONGO_EXPRESS_HOST || 'mongo-express',
    port: Number(process.env.MONGO_EXPRESS_INTERNAL_PORT || 8081),
    method: req.method,
    path: req.originalUrl,
    headers: {
      ...req.headers,
      host: 'mongo-express:8081',
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      'x-forwarded-host': req.get('host') || '',
      'x-forwarded-proto': req.protocol,
    },
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', (error) => {
    if (res.headersSent) return res.destroy(error);
    console.error('Falha ao acessar Mongo Express:', error.message);
    res.status(502).send('A interface do banco está indisponível.');
  });
  req.pipe(upstream);
};

app.use('/database', requireAuthView, requireAdmin, proxyMongoExpress);

const getUserId = (req) => req.session?.user?.id;
const isOwner = (createdBy, userId) => createdBy && userId && String(createdBy) === String(userId);
const toIdArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

// ============ ROTAS ============

// Nota: rota `/media/jogo/:id` removida — imagens agora são servidas como data URLs

app.get('/api/conteudos/:id/pdf', requireAuthApi, async (req, res) => {
  try {
    await connectDB();
    const conteudo = await ConteudoRelacionado.findById(req.params.id);

    if (!conteudo) return notFound(res, 'Conteúdo não encontrado');

    // Preferir PDF armazenado no documento
    if (conteudo.pdf && conteudo.pdf.length) {
      const mime = conteudo.pdf_mime || 'application/pdf';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${conteudo.titulo || 'conteudo'}.pdf"`);
      return res.send(conteudo.pdf);
    }

    // Fallback para URL externa
    if (conteudo.pdf_url) return res.redirect(conteudo.pdf_url);

    return res.status(404).send('PDF não disponível');
  } catch (error) {
    console.error('Erro ao servir PDF:', error);
    res.status(500).send('Erro ao carregar PDF');
  }
});

// Rota pública para servir PDF de conteúdo (sem exigir autenticação)
app.get('/conteudo/public/pdf/:id', async (req, res) => {
  try {
    await connectDB();
    const id = req.params.id;
    const conteudo = await ConteudoRelacionado.findById(id).lean();
    if (!conteudo) return res.status(404).send('Conteúdo não encontrado');

    // Se o PDF está embutido no documento
    if (conteudo.pdf && conteudo.pdf.length) {
      const buffer = Buffer.from(conteudo.pdf.buffer || conteudo.pdf);
      const mime = conteudo.pdf_mime || 'application/pdf';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${(conteudo.titulo || 'conteudo').replace(/\"/g, '')}.pdf"`);
      return res.send(buffer);
    }

    // Se houver URL pública, redireciona
    if (conteudo.pdf_url) return res.redirect(conteudo.pdf_url);

    return res.status(404).send('PDF não disponível');
  } catch (err) {
    console.error('Erro em /conteudo/public/pdf/:id', err);
    res.status(500).send('Erro ao carregar PDF');
  }
});

// ==== VIEWS ====
app.get('/', (req, res) => {
  try {
    if (req.session?.user) return res.redirect('/home');
    res.render('auth/login', { title: 'Ludus - Login' });
  } catch (err) {
    console.error('Erro ao renderizar login:', err);
    res.status(500).send('Erro ao carregar página');
  }
});

// Login/Logout
app.post('/login', async (req, res) => {
  try {
    await connectDB();
    const email = (req.body.email || req.body.username || '').toLowerCase();
    const senha = req.body.password || req.body.senha;
    console.log('Tentativa de login:', email);
    
    if (!email || !senha) {
      console.log('Login falhou: campos vazios');
      return res.status(400).render('auth/login', { title: 'Ludus - Login', error: 'Informe e-mail e senha.' });
    }
    
    const user = await Usuario.findOne({ email_usuario: email });
    console.log('Login busca usuário:', user ? { id: user._id.toString(), email: user.email_usuario, perfil: user.perfil } : 'não encontrado');
    if (!user) {
      return res.status(401).render('auth/login', { title: 'Ludus - Login', error: 'Credenciais inválidas.' });
    }
    
    const ok = await bcrypt.compare(senha, user.senha_hash);
    console.log('Resultado comparação senha:', ok);
    if (!ok) {
      return res.status(401).render('auth/login', { title: 'Ludus - Login', error: 'Credenciais inválidas.' });
    }
    
    req.session.user = {
      id: user._id.toString(),
      nome_usuario: user.nome_usuario,
      email_usuario: user.email_usuario,
      instituicao_usuario: user.instituicao_usuario,
      perfil: user.perfil || [],
    };
    
    console.log('Login bem-sucedido:', email);
    return res.redirect('/home');
  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).render('auth/login', { title: 'Ludus - Login', error: 'Erro no servidor: ' + err.message });
  }
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

app.get('/home', requireAuthView, (req, res) => {
  res.render('admin/home', { title: 'Home - Ludus' });
});

app.get('/ocorrencias', requireAuthView, (req, res) => {
  res.render('admin/ocorrencias', { title: 'Ocorrências - Ludus' });
});

app.get('/aulas', requireAuthView, (req, res) => {
  res.render('admin/aulas/aulas', { title: 'Aulas - Ludus' });
});

app.get('/detalhes', requireAuthView, (req, res) => {
  res.render('admin/aulas/detalhes', { title: 'Fase • Detalhes' });
});

app.get('/mapeamento', requireAuthView, (req, res) => {
  res.render('admin/mapeamento/mapeamento', { title: 'Mapeamento de Jogos' });
});

app.get('/addjogo', requireAuthView, (req, res) => {
  res.render('admin/mapeamento/addjogo', { title: 'Mapeamento de Jogos' });
});

app.get('/addfase', requireAuthView, (req, res) => {
  res.render('admin/mapeamento/addfase', { title: 'Mapeamento de Jogos' });
});

app.get('/addfaseok', requireAuthView, (req, res) => {
  res.render('admin/mapeamento/addfaseok', { nomeFase: req.query['nome-fase'] });
});

app.get('/addcena', requireAuthView, (req, res) => {
  res.render('admin/mapeamento/addcena', { title: 'Mapeamento de Jogos' });
});

app.get('/conteudos-admin', requireAuthView, requireAdmin, (req, res) => {
  res.render('admin/conteudos/conteudos', { title: 'Conteúdos Relacionados' });
});

app.get('/addcenaok', requireAuthView, (req, res) => {
  res.render('admin/mapeamento/addcenaok', { nomeFase: req.query['nome-fase'] });
});

app.get('/usuario', requireAuthView, async (req, res) => {
  try {
    await connectDB();
    const self = await Usuario.findById(req.session.user.id);
    if (isAdminPerfil(req.session?.user?.perfil)) {
      return res.render('admin/usuario/usuario', { title: 'Usuários da Instituição', currentUser: self });
    }
    return res.render('admin/usuario/me', { title: 'Meu Perfil', currentUser: self });
  } catch (e) {
    console.error('Erro ao carregar perfil do usuário:', e);
    return res.redirect('/');
  }
});

app.get('/turmas', requireAuthView, (req, res) => {
  res.render('admin/turmas/turmas', { title: 'Turmas e Jogadores - Ludus' });
});

app.get('/jogadores', (req, res) => {
  res.redirect('/turmas');
});

// ==== APIs REST ====
// Helpers simples
const notFound = (res, msg = 'Não encontrado') => res.status(404).json({ error: msg });
const badRequest = (res, msg) => res.status(400).json({ error: msg });

// Seed Admin (proteção por token) - também atualiza senha se já existir
app.post('/seed-admin', async (req, res) => {
  try {
    await connectDB();
    const token = req.body.token || req.query.token;
    const expected = process.env.ADMIN_SEED_TOKEN || 'seed-admin-dev';
    if (token !== expected) return res.status(403).json({ error: 'Token inválido' });

    const email = (req.body.email || 'admin@ludus.local').toLowerCase();
    const nome = req.body.nome || 'Administrador';
    const senha = req.body.senha || 'admin123';
    const instituicao = req.body.instituicao || 'Ludus';

    const hash = await bcrypt.hash(senha, 10);
    const exists = await Usuario.findOne({ email_usuario: email });
    if (exists) {
      exists.nome_usuario = nome;
      exists.instituicao_usuario = instituicao;
      exists.senha_hash = hash;
      exists.perfil = ['Administrador'];
      await exists.save();
      return res.json({ ok: true, message: 'Admin atualizado', userId: exists._id });
    }

    const novo = await Usuario.create({
      nome_usuario: nome,
      email_usuario: email,
      senha_hash: hash,
      instituicao_usuario: instituicao,
      perfil: ['Administrador']
    });
    res.status(201).json({ ok: true, userId: novo._id, email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar/atualizar admin' });
  }
});

// Proteger todas as APIs: requer login
app.use('/api', requireAuthApi);

// Middleware para garantir conexão DB em todas as rotas /api
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Erro ao conectar DB:', err);
    res.status(503).json({ error: 'Serviço indisponível' });
  }
});

// ---- Usuários perfil instituição (admin) ----
app.post('/api/usuarios-instituicao', requireAdmin, async (req, res) => {
  try {
    const { nome_usuario, email_usuario, senha_usuario, instituicao_usuario, perfil = '' } = req.body;
    if (!nome_usuario || !email_usuario || !senha_usuario || !instituicao_usuario) return badRequest(res, 'Campos obrigatórios ausentes');
    const exists = await Usuario.findOne({ email_usuario: email_usuario.toLowerCase() });
    if (exists) return badRequest(res, 'E-mail já cadastrado');
    const hash = await bcrypt.hash(senha_usuario, 10);
    const perfilArr = Array.isArray(perfil) ? perfil.slice(0,1) : (typeof perfil === 'string' && perfil ? [perfil] : []);
    const novo = await Usuario.create({
      nome_usuario,
      email_usuario: email_usuario.toLowerCase(),
      senha_hash: hash,
      instituicao_usuario,
      perfil: perfilArr
    });
    res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

app.get('/api/usuarios-instituicao', requireAdmin, async (_req, res) => {
  const usuarios = await Usuario.find({});
  res.json(usuarios);
});

app.put('/api/usuarios-instituicao/:id', requireAdmin, async (req, res) => {
  try {
    const { nome_usuario, email_usuario, senha_usuario, instituicao_usuario, perfil } = req.body;
    const user = await Usuario.findById(req.params.id);
    if (!user) return notFound(res);
    if (nome_usuario) user.nome_usuario = nome_usuario;
    if (email_usuario) user.email_usuario = email_usuario.toLowerCase();
    if (instituicao_usuario) user.instituicao_usuario = instituicao_usuario;
    if (perfil !== undefined) user.perfil = Array.isArray(perfil) ? perfil.slice(0,1) : (typeof perfil === 'string' && perfil ? [perfil] : []);
    if (senha_usuario) user.senha_hash = await bcrypt.hash(senha_usuario, 10);
    await user.save();
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

app.delete('/api/usuarios-instituicao/:id', requireAdmin, async (req, res) => {
  const deleted = await Usuario.findByIdAndDelete(req.params.id);
  if (!deleted) return notFound(res);
  res.json({ ok: true });
});

// ---- Categorias de Jogos (admin) ----
app.post('/api/categorias', requireAdmin, async (req, res) => {
  try {
    const nome = (req.body.nome || '').trim();
    if (!nome) return badRequest(res, 'Nome da categoria é obrigatório');

    const exists = await Categoria.findOne({ nome: { $regex: `^${nome}$`, $options: 'i' } });
    if (exists) return badRequest(res, 'Categoria já existe');

    const nova = await Categoria.create({ nome, createdBy: getUserId(req) });
    res.status(201).json(nova);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar categoria' });
  }
});

app.get('/api/categorias', async (_req, res) => {
  const categorias = await Categoria.find({}).sort({ nome: 1 });
  res.json(categorias);
});

app.put('/api/categorias/:id', requireAdmin, async (req, res) => {
  try {
    const nome = (req.body.nome || '').trim();
    if (!nome) return badRequest(res, 'Nome da categoria é obrigatório');

    const categoria = await Categoria.findById(req.params.id);
    if (!categoria) return notFound(res);

    const exists = await Categoria.findOne({ _id: { $ne: req.params.id }, nome: { $regex: `^${nome}$`, $options: 'i' } });
    if (exists) return badRequest(res, 'Categoria já existe');

    categoria.nome = nome;
    await categoria.save();
    res.json(categoria);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar categoria' });
  }
});

app.delete('/api/categorias/:id', requireAdmin, async (req, res) => {
  const usada = await Jogo.findOne({ categorias: req.params.id });
  if (usada) return badRequest(res, 'Categoria vinculada a jogos. Remova dos jogos antes.');
  const deleted = await Categoria.findByIdAndDelete(req.params.id);
  if (!deleted) return notFound(res);
  res.json({ ok: true });
});

// ---- Jogos (admin) ----
app.post('/api/jogos', requireAdmin, uploadGame, async (req, res) => {
  try {
    const { nome, descricao, identificacao_unity, link_jogar, total_niveis, xp_maxima, createdBy, categorias, video_demo_url, github_url, ativo } = req.body;
    if (!nome || !identificacao_unity) return badRequest(res, 'Nome e identificação são obrigatórios');
    
    const jogoData = { nome, descricao, identificacao_unity, createdBy, ativo: ativo === undefined ? true : String(ativo) !== 'false' };
    const icone = getUploadedFile(req, 'icone');
    if (icone) {
      // Salva o buffer diretamente no documento e gera data URL para o front
      jogoData.icone = icone.buffer;
      jogoData.icone_url = `data:${icone.mimetype};base64,${icone.buffer.toString('base64')}`;
      jogoData.icone_id = null;
    }
    
    if (link_jogar) jogoData.link_jogar = link_jogar;
    if (total_niveis) jogoData.total_niveis = total_niveis;
    if (xp_maxima) jogoData.xp_maxima = xp_maxima;
    if (video_demo_url) jogoData.video_demo_url = video_demo_url;
    if (github_url) jogoData.github_url = github_url;
    const categoriasArr = toIdArray(categorias);
    if (categoriasArr.length) jogoData.categorias = categoriasArr;
    
    const jogo = await Jogo.create(jogoData);
    try {
      const arquivoJogo = getUploadedFile(req, 'arquivo_jogo');
      const urlArquivoJogo = String(req.body.url_arquivo_jogo || '').trim();
      if (arquivoJogo || urlArquivoJogo) {
        const archive = arquivoJogo?.buffer || await downloadGameArchive(urlArquivoJogo);
        jogo.link_jogar = await publishGameArchive(archive, jogo.nome, jogo._id);
        jogo.game_public_path = jogo.link_jogar;
        await jogo.save();
      }
    } catch (error) {
      await jogo.deleteOne().catch(() => {});
      throw error;
    }
    res.status(201).json(jogo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao criar jogo' });
  }
});

app.get('/api/jogos', async (req, res) => {
  // Administradores precisam ver jogos desabilitados para poderem reativá-los.
  const filtro = isAdminPerfil(req.session?.user?.perfil) ? {} : { ativo: { $ne: false } };
  const jogos = await Jogo.find(filtro).populate('categorias', 'nome');
  res.json(jogos);
});

app.put('/api/jogos/:id', requireAdmin, uploadGame, async (req, res) => {
  try {
    const jogo = await Jogo.findById(req.params.id);
    if (!jogo) return notFound(res);
    
    const { nome, descricao, identificacao_unity, link_jogar, total_niveis, xp_maxima, categorias, video_demo_url, github_url, ativo } = req.body;
    
    if (nome) jogo.nome = nome;
    if (descricao) jogo.descricao = descricao;
    if (identificacao_unity) jogo.identificacao_unity = identificacao_unity;
    if (link_jogar) jogo.link_jogar = link_jogar;
    if (total_niveis) jogo.total_niveis = total_niveis;
    if (xp_maxima) jogo.xp_maxima = xp_maxima;
    if (video_demo_url !== undefined) jogo.video_demo_url = video_demo_url || undefined;
    if (github_url !== undefined) jogo.github_url = github_url || undefined;
    if (ativo !== undefined) jogo.ativo = String(ativo) !== 'false';
    const categoriasArr = toIdArray(categorias);
    if (categorias !== undefined) jogo.categorias = categoriasArr;
    
    const icone = getUploadedFile(req, 'icone');
    if (icone) {
      // Salva buffer direto no documento e atualiza icone_url com data URL
      jogo.icone = icone.buffer;
      jogo.icone_url = `data:${icone.mimetype};base64,${icone.buffer.toString('base64')}`;
      jogo.icone_id = null;
    }
    
    const arquivoJogo = getUploadedFile(req, 'arquivo_jogo');
    const urlArquivoJogo = String(req.body.url_arquivo_jogo || '').trim();
    if (arquivoJogo || urlArquivoJogo) {
      const previousPublicPath = jogo.game_public_path;
      const archive = arquivoJogo?.buffer || await downloadGameArchive(urlArquivoJogo);
      jogo.link_jogar = await publishGameArchive(archive, jogo.nome, jogo._id);
      jogo.game_public_path = jogo.link_jogar;
      if (previousPublicPath && previousPublicPath !== jogo.game_public_path) await removePublishedGame(previousPublicPath);
    }
    await jogo.save();
    res.json(jogo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar jogo' });
  }
});

app.delete('/api/jogos/:id', requireAdmin, async (req, res) => {
  const deleted = await Jogo.findByIdAndDelete(req.params.id);
  if (!deleted) return notFound(res);
  await removePublishedGame(deleted.game_public_path).catch((error) => console.error('Não foi possível remover arquivos publicados do jogo:', error));
  res.json({ ok: true });
});

// ---- Conteúdos Relacionados (admin) ----
const normalizaTipoConteudo = (tipo) => {
  if (!tipo) return undefined;
  const t = String(tipo).trim().toLowerCase();
  if (t === 'artigo') return 'Artigo';
  if (t === 'evento') return 'Evento';
  if (t === 'artigo e evento') return 'Artigo e Evento';
  return undefined;
};

app.post('/api/conteudos', requireAdmin, uploadPdf.single('arquivo_pdf'), async (req, res) => {
  try {
    const { titulo, descricao } = req.body;
    let { link_externo, tipo, jogos, data_postagem } = req.body;
    if (!titulo || !descricao) return badRequest(res, 'Título e descrição são obrigatórios');

    // Normalizar campos opcionais: aceitar strings vazias do front-end e convertê-las para undefined
    link_externo = link_externo && String(link_externo).trim() ? String(link_externo).trim() : undefined;
    data_postagem = data_postagem ? new Date(`${data_postagem}T00:00:00`) : undefined;
    if (data_postagem && Number.isNaN(data_postagem.getTime())) return badRequest(res, 'Data de postagem inválida');

    const conteudoData = {
      titulo,
      descricao,
      link_externo,
      tipo: normalizaTipoConteudo(tipo),
      data_postagem,
      pdf: req.file ? req.file.buffer : undefined,
      pdf_mime: req.file ? req.file.mimetype : undefined,
      pdf_id: null,
      pdf_url: null,
      jogos: toIdArray(jogos),
      createdBy: getUserId(req)
    };

    const conteudo = await ConteudoRelacionado.create(conteudoData);
    res.status(201).json(conteudo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao criar conteúdo' });
  }
});

app.get('/api/conteudos', async (req, res) => {
  const filtro = {};
  if (req.query.jogo) filtro.jogos = req.query.jogo;
  const conteudos = await ConteudoRelacionado.find(filtro).populate('jogos', 'nome identificacao_unity');
  res.json(conteudos);
});

app.put('/api/conteudos/:id', requireAdmin, uploadPdf.single('arquivo_pdf'), async (req, res) => {
  try {
    const conteudo = await ConteudoRelacionado.findById(req.params.id);
    if (!conteudo) return notFound(res);

    const { titulo, descricao, link_externo, tipo, jogos, data_postagem } = req.body;

    if (titulo) conteudo.titulo = titulo;
    if (descricao) conteudo.descricao = descricao;
    if (link_externo !== undefined) conteudo.link_externo = link_externo || undefined;
    if (tipo !== undefined) conteudo.tipo = normalizaTipoConteudo(tipo);
    if (data_postagem !== undefined) {
      const data = data_postagem ? new Date(`${data_postagem}T00:00:00`) : undefined;
      if (data && Number.isNaN(data.getTime())) return badRequest(res, 'Data de postagem inválida');
      conteudo.data_postagem = data;
    }
    if (jogos !== undefined) conteudo.jogos = toIdArray(jogos);

    if (req.file) {
      // Substituir PDF armazenado no documento
      conteudo.pdf = req.file.buffer;
      conteudo.pdf_mime = req.file.mimetype;
      conteudo.pdf_id = null;
      conteudo.pdf_url = null;
    }

    await conteudo.save();
    res.json(conteudo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao atualizar conteúdo' });
  }
});

app.delete('/api/conteudos/:id', requireAdmin, async (req, res) => {
  try {
    const conteudo = await ConteudoRelacionado.findById(req.params.id);
    if (!conteudo) return notFound(res);

    // Limpar referências internas de PDF
    conteudo.pdf = undefined;
    conteudo.pdf_mime = undefined;
    conteudo.pdf_id = null;

    const deleted = await ConteudoRelacionado.findByIdAndDelete(req.params.id);
    if (!deleted) return notFound(res);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Turmas (admin ou instituição) ----
app.post('/api/turmas', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { nome_turma } = req.body;
    const createdBy = isAdminPerfil(req.session?.user?.perfil) ? (req.body.createdBy || userId) : userId;
    if (!nome_turma || !createdBy) return badRequest(res, 'Dados obrigatórios ausentes');
    const turma = await Turma.create({ nome_turma, createdBy });
    res.status(201).json(turma);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar turma' });
  }
});

app.get('/api/turmas', async (req, res) => {
  const userId = getUserId(req);
  const isAdmin = isAdminPerfil(req.session?.user?.perfil);
  const filtro = isAdmin ? {} : { createdBy: userId };
  const turmas = await Turma.find(filtro).populate('createdBy', 'nome_usuario email_usuario');
  res.json(turmas);
});

app.put('/api/turmas/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const isAdmin = isAdminPerfil(req.session?.user?.perfil);
    const turma = await Turma.findById(req.params.id);
    if (!turma) return notFound(res);
    if (!isAdmin && !isOwner(turma.createdBy, userId)) return res.status(403).json({ error: 'Acesso negado' });

    if (req.body.nome_turma) turma.nome_turma = req.body.nome_turma;
    if (isAdmin && req.body.createdBy) turma.createdBy = req.body.createdBy;
    await turma.save();
    res.json(turma);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar turma' });
  }
});

app.delete('/api/turmas/:id', async (req, res) => {
  const userId = getUserId(req);
  const isAdmin = isAdminPerfil(req.session?.user?.perfil);
  const turma = await Turma.findById(req.params.id);
  if (!turma) return notFound(res);
  if (!isAdmin && !isOwner(turma.createdBy, userId)) return res.status(403).json({ error: 'Acesso negado' });
  await turma.deleteOne();
  res.json({ ok: true });
});

// ---- Jogadores por Turma (admin ou instituição) ----
app.post('/api/jogadores', async (req, res) => {
  try {
    const userId = getUserId(req);
    const isAdmin = isAdminPerfil(req.session?.user?.perfil);
    const { nome_jogador, login, senha, turma } = req.body;
    if (!nome_jogador || !login || !senha || !turma) return badRequest(res, 'Dados obrigatórios ausentes');

    const turmaDoc = await Turma.findById(turma);
    if (!turmaDoc) return notFound(res, 'Turma não encontrada');
    if (!isAdmin && !isOwner(turmaDoc.createdBy, userId)) return res.status(403).json({ error: 'Acesso negado' });

    const jogadorData = {
      nome_jogador,
      login: login.toLowerCase(),
      senha_hash: await bcrypt.hash(senha, 10),
      senha_visivel: senha,
      turma,
      createdBy: isAdmin ? (req.body.createdBy || userId) : userId
    };

    const jogador = await Jogador.create(jogadorData);
    res.status(201).json(jogador);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao criar jogador' });
  }
});

app.get('/api/jogadores', async (req, res) => {
  const { turma } = req.query;
  const userId = getUserId(req);
  const isAdmin = isAdminPerfil(req.session?.user?.perfil);

  if (isAdmin) {
    const filtro = turma ? { turma } : {};
    const jogadores = await Jogador.find(filtro)
      .populate('turma', 'nome_turma createdBy')
      .populate('createdBy', 'nome_usuario email_usuario');
    return res.json(jogadores);
  }

  const turmasDoUsuario = await Turma.find({ createdBy: userId }).select('_id');
  const turmaIds = turmasDoUsuario.map(t => t._id);
  if (!turmaIds.length) return res.json([]);

  const filtro = { turma: { $in: turmaIds } };
  const jogadores = await Jogador.find(filtro)
    .populate('turma', 'nome_turma createdBy')
    .populate('createdBy', 'nome_usuario email_usuario');
  res.json(jogadores);
});

app.put('/api/jogadores/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const isAdmin = isAdminPerfil(req.session?.user?.perfil);
    const jogador = await Jogador.findById(req.params.id).populate('turma');
    if (!jogador) return notFound(res);
    if (!isAdmin && !isOwner(jogador.turma?.createdBy, userId)) return res.status(403).json({ error: 'Acesso negado' });

    const { login, senha, turma, nome_jogador } = req.body;
    if (login) jogador.login = login.toLowerCase();
    if (nome_jogador) jogador.nome_jogador = nome_jogador;
    if (turma) {
      const turmaDoc = await Turma.findById(turma);
      if (!turmaDoc) return notFound(res, 'Turma não encontrada');
      if (!isAdmin && !isOwner(turmaDoc.createdBy, userId)) return res.status(403).json({ error: 'Acesso negado' });
      jogador.turma = turma;
    }
    if (senha) {
      jogador.senha_hash = await bcrypt.hash(senha, 10);
      jogador.senha_visivel = senha;
    }
    await jogador.save();
    res.json(jogador);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao atualizar jogador' });
  }
});

app.delete('/api/jogadores/:id', async (req, res) => {
  const userId = getUserId(req);
  const isAdmin = isAdminPerfil(req.session?.user?.perfil);
  const jogador = await Jogador.findById(req.params.id).populate('turma');
  if (!jogador) return notFound(res);
  if (!isAdmin && !isOwner(jogador.turma?.createdBy, userId)) return res.status(403).json({ error: 'Acesso negado' });
  await jogador.deleteOne();
  res.json({ ok: true });
});

// ============ FIM ROTAS ============

app.use((error, req, res, next) => {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'O arquivo excede o limite permitido' : `Falha no envio: ${error.message}` });
  }
  if (req.originalUrl.startsWith('/api/')) return res.status(400).json({ error: error.message || 'Falha ao processar o arquivo enviado' });
  next(error);
});

export default app;

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✓ Servidor admin rodando em http://localhost:${PORT}`);
  });
}
