import mongoose from "mongoose";
const url =
"mongodb+srv://Aluno:123@cluster0.9ekdn5x.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
const conexao = await mongoose.connect(url)
export default conexao