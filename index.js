import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import multer from 'multer';
import dotenv from 'dotenv';
import session from 'express-session';

// Caminho correto das views e public
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Models
import Usuario from './models/Usuario.js';
import Jogo from './models/Jogo.js';
import Turma from './models/Turma.js';
import Jogador from './models/Jogador.js';

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');

// Servir arquivos estáticos
app.use(express.static(join(__dirname, 'public')));
app.set('views', join(__dirname, 'views'));

// Sessões para autenticação
app.use(
  session({
    name: 'sid',
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// Configurar multer para upload de imagens
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, join(__dirname, 'public', 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = file.originalname.split('.').pop();
    cb(null, 'jogo-' + uniqueSuffix + '.' + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Apenas imagens são permitidas'), false);
  }
};

const upload = multer({ storage, fileFilter });

// Conectar ao MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ludus';
mongoose.connect(MONGO_URI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
})
.then(() => console.log('MongoDB conectado'))
.catch(err => console.error('Erro ao conectar MongoDB:', err));

// Garantir admin existente
async function ensureAdmin() {
  try {
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

const getUserId = (req) => req.session?.user?.id;
const isOwner = (createdBy, userId) => createdBy && userId && String(createdBy) === String(userId);

// ==== VIEWS (mantidas) ====
app.get('/', (req, res) => {
  res.render('auth/login', { title: 'Ludus - Login' });
});

// Login/Logout
app.post('/login', async (req, res) => {
  try {
    const email = (req.body.email || req.body.username || '').toLowerCase();
    const senha = req.body.password || req.body.senha;
    if (!email || !senha) {
      return res.status(400).render('auth/login', { title: 'Ludus - Login', error: 'Informe e-mail e senha.' });
    }
    const user = await Usuario.findOne({ email_usuario: email });
    if (!user) {
      return res.status(401).render('auth/login', { title: 'Ludus - Login', error: 'Credenciais inválidas.' });
    }
    const ok = await bcrypt.compare(senha, user.senha_hash);
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
    return res.redirect('/ocorrencias');
  } catch (err) {
    console.error(err);
    return res.status(500).render('auth/login', { title: 'Ludus - Login', error: 'Erro no servidor.' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
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
app.get('/addcenaok', requireAuthView, (req, res) => {
  res.render('admin/mapeamento/addcenaok', { nomeFase: req.query['nome-fase'] });
});
app.get('/usuario', requireAuthView, async (req, res) => {
  try {
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

// ==== APIs REST ====
// Helpers simples
const notFound = (res, msg = 'Não encontrado') => res.status(404).json({ error: msg });
const badRequest = (res, msg) => res.status(400).json({ error: msg });

// Seed Admin (proteção por token)
app.post('/seed-admin', async (req, res) => {
  try {
    const token = req.body.token || req.query.token;
    const expected = process.env.ADMIN_SEED_TOKEN || 'seed-admin-dev';
    if (token !== expected) return res.status(403).json({ error: 'Token inválido' });

    const email = (req.body.email || 'admin@ludus.local').toLowerCase();
    const nome = req.body.nome || 'Administrador';
    const senha = req.body.senha || 'admin123';
    const instituicao = req.body.instituicao || 'Ludus';

    const exists = await Usuario.findOne({ email_usuario: email });
    if (exists) return res.json({ ok: true, message: 'Admin já existe', userId: exists._id });

    const hash = await bcrypt.hash(senha, 10);
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
    res.status(500).json({ error: 'Erro ao criar admin' });
  }
});

// Proteger todas as APIs: requer login
app.use('/api', requireAuthApi);

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

// ---- Jogos (admin) ----
app.post('/api/jogos', requireAdmin, upload.single('icone'), async (req, res) => {
  try {
    const { nome, descricao, identificacao_unity, link_jogar, total_niveis, xp_maxima, createdBy } = req.body;
    if (!nome || !identificacao_unity) return badRequest(res, 'Nome e identificação são obrigatórios');
    
    let icone_url = null;
    if (req.file) {
      icone_url = '/uploads/' + req.file.filename;
    }
    
    const jogoData = { 
      nome, 
      descricao, 
      identificacao_unity, 
      icone_url,
      createdBy 
    };
    
    if (link_jogar) jogoData.link_jogar = link_jogar;
    if (total_niveis) jogoData.total_niveis = total_niveis;
    if (xp_maxima) jogoData.xp_maxima = xp_maxima;
    
    const jogo = await Jogo.create(jogoData);
    res.status(201).json(jogo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao criar jogo' });
  }
});

app.get('/api/jogos', async (_req, res) => {
  const jogos = await Jogo.find({});
  res.json(jogos);
});

app.put('/api/jogos/:id', requireAdmin, upload.single('icone'), async (req, res) => {
  try {
    const jogo = await Jogo.findById(req.params.id);
    if (!jogo) return notFound(res);
    
    const { nome, descricao, identificacao_unity, link_jogar, total_niveis, xp_maxima } = req.body;
    
    if (nome) jogo.nome = nome;
    if (descricao) jogo.descricao = descricao;
    if (identificacao_unity) jogo.identificacao_unity = identificacao_unity;
    if (link_jogar) jogo.link_jogar = link_jogar;
    if (total_niveis) jogo.total_niveis = total_niveis;
    if (xp_maxima) jogo.xp_maxima = xp_maxima;
    if (req.file) jogo.icone_url = '/uploads/' + req.file.filename;
    
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
  res.json({ ok: true });
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
    if (senha) jogador.senha_hash = await bcrypt.hash(senha, 10);
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

app.get('/turmas', requireAuthView, (req, res) => {
  res.render('admin/turmas/turmas', { title: 'Turmas e Jogadores - Ludus' });
});

app.get('/jogadores', (req, res) => {
  res.redirect('/turmas');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
