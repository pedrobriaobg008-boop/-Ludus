import mongoose from 'mongoose';

const JogoSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  descricao: { type: String },
  identificacao_unity: { type: String, required: true },
  link_jogar: { type: String },
  video_demo_url: { type: String },
  github_url: { type: String },
  // Novo campo: armazenar o ícone diretamente no documento como Buffer
  icone: {
    type: Buffer,
    get: (valor) => {
      if (!valor) return null;
      return `data:image/png;base64,${valor.toString('base64')}`;
    }
  },
  // Mantemos `icone_url` por compatibilidade com o front-end;
  // será preenchido com data URL quando o upload for feito.
  icone_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  icone_url: { type: String },
  categorias: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Categoria' }],
  total_niveis: { type: Number },
  xp_maxima: { type: Number },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.Jogo || mongoose.model('Jogo', JogoSchema);