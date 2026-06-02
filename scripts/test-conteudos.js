import fs from 'fs';

const API = 'http://localhost:3000';

async function run() {
  try {
    console.log('Login...');
    const loginResp = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@ludus.local', password: 'admin123' }),
      redirect: 'manual'
    });
    console.log('Login status:', loginResp.status);
    const loginText = await loginResp.text();
    console.log('Login body snippet:', loginText.slice(0,200));
    const cookies = loginResp.headers.get('set-cookie');
    console.log('Cookies:', cookies && cookies.split(';')[0]);

    // Get jogos
    console.log('Buscando jogos...');
    const jogosResp = await fetch(`${API}/api/jogos`, { headers: { Cookie: cookies } });
    const jogos = await jogosResp.json();
    if (!jogos || jogos.length === 0) {
      console.log('Nenhum jogo disponível para vincular.');
      return;
    }
    const jogoId = jogos[0]._id;
    console.log('Usando jogo:', jogoId, jogos[0].nome);

    // Create conteudo tipo Evento
    console.log('Criando conteudo (Evento)...');
    const form = new FormData();
    form.append('titulo', 'Teste Evento via script');
    form.append('descricao', 'Descrição do evento teste');
    form.append('tipo', 'Evento');
    form.append('jogos', jogoId);
    form.append('link_externo', 'https://example.com/teste');

    const createResp = await fetch(`${API}/api/conteudos`, {
      method: 'POST',
      headers: { Cookie: cookies },
      body: form
    });
    const created = await createResp.json();
    console.log('Create status:', createResp.status, 'id:', created._id);
    const createdId = created._id;

    // Verify the created content appears when filtering by jogo
    console.log('Verificando retorno por jogo...');
    const listResp = await fetch(`${API}/api/conteudos?jogo=${jogoId}`, { headers: { Cookie: cookies } });
    const listJson = await listResp.json();
    const found = listJson.find(c => c._id === createdId);
    console.log('Encontrado no filtro por jogo:', Boolean(found));

    // Now try updating to remove link_externo
    console.log('Atualizando para remover link_externo...');
    const updateResp = await fetch(`${API}/api/conteudos/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookies },
      body: JSON.stringify({ link_externo: '' })
    });
    const updated = await updateResp.json();
    console.log('Update status:', updateResp.status, 'link_externo after:', updated.link_externo);

  } catch (err) {
    console.error('Erro:', err.response?.data || err.message);
  }
}

run();
