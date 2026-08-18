import 'dotenv/config';
import mongoose from 'mongoose';

const url = process.env.MONGO_URI;

if (!url) {
  throw new Error('MONGO_URI não configurada');
}

const conexao = mongoose.connect(url);

export default conexao;
