import mongoose from 'mongoose';

const UsuarioSchema = new mongoose.Schema({
    nome_usuario: { type: String, required: true },
    email_usuario: { type: String, required: true, unique: true },
    senha_hash: { type: String, required: true },
    instituicao_usuario: { type: String, required: true },
    perfil: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.Usuario || mongoose.model('Usuario', UsuarioSchema);