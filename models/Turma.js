import mongoose from 'mongoose';

const TurmaSchema = new mongoose.Schema({
  nome_turma: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.Mixed, required: true }, // Aceita string ou ObjectId
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.Turma || mongoose.model('Turma', TurmaSchema);