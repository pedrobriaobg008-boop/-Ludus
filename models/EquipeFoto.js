import mongoose from 'mongoose';

const equipeFotoSchema = new mongoose.Schema({
  mimeType: { type: String, enum: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], required: true },
  dados: { type: Buffer, required: true }
}, { timestamps: true });

export default mongoose.models.EquipeFoto || mongoose.model('EquipeFoto', equipeFotoSchema);
