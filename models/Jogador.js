import mongoose from 'mongoose';

const JogadorSchema = new mongoose.Schema({
  login: { type: String, required: true, unique: true },
  senha_hash: { type: String, required: true },
  senha_visivel: { type: String, required: true },
  nome_jogador: { type: String, required: true },
  turma: { type: mongoose.Schema.Types.ObjectId, ref: 'Turma', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.Jogador || mongoose.model('Jogador', JogadorSchema);