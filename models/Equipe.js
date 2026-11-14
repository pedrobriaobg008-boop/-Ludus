import mongoose from 'mongoose';

const integranteSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  nome: { type: String, required: true, trim: true },
  cargo: { type: String, required: true, trim: true },
  instituicao: { type: String, required: true, trim: true },
  foto: { type: String, default: '' },
  bio: { type: String, default: '' },
  lattes: { type: String, default: '', trim: true }
}, { _id: false });

const secaoSchema = new mongoose.Schema({
  id: { type: String, required: true },
  titulo: { type: String, required: true, trim: true },
  tema: { type: String, enum: ['azul', 'rosa'], default: 'azul' },
  icone: { type: String, default: '' },
  integrantes: { type: [integranteSchema], default: [] }
}, { _id: false });

const equipeSchema = new mongoose.Schema({
  descricao: { type: String, required: true, trim: true },
  secoes: { type: [secaoSchema], default: [] }
}, { timestamps: true });

export default mongoose.models.Equipe || mongoose.model('Equipe', equipeSchema);
