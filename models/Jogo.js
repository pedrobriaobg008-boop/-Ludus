import mongoose from 'mongoose';

const JogoSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  descricao: { type: String },
  identificacao_unity: { type: String, required: true },
  link_jogar: { type: String },
  icone_url: { type: String },
  total_niveis: { type: Number },
  xp_maxima: { type: Number },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.Jogo || mongoose.model('Jogo', JogoSchema);