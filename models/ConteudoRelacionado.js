import mongoose from 'mongoose';

const ConteudoRelacionadoSchema = new mongoose.Schema({
  titulo: { type: String, required: true, trim: true },
  descricao: { type: String, required: true, trim: true },
  link_externo: { type: String },
  // Armazenar PDF diretamente no documento (Buffer) e tipo MIME
  pdf: { type: Buffer },
  pdf_mime: { type: String },
  pdf_id: { type: mongoose.Schema.Types.ObjectId, ref: 'pdf_files.files', default: null },
  pdf_url: { type: String }, // mantido para compatibilidade com URLs antigas
  tipo: { type: String, enum: ['Artigo', 'Evento', 'Artigo e Evento', null], default: null },
  data_postagem: { type: Date },
  jogos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Jogo' }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.ConteudoRelacionado || mongoose.model('ConteudoRelacionado', ConteudoRelacionadoSchema);
