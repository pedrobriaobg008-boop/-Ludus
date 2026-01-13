import mongoose from 'mongoose';

const CategoriaSchema = new mongoose.Schema({
  nome: { type: String, required: true, trim: true, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.Categoria || mongoose.model('Categoria', CategoriaSchema);
