// panel/importarContatos.js
//
// "Importar contatos" — página/modal dedicada a pegar uma lista de contatos
// vinda de outro sistema (CRM antigo, planilha, texto colado de qualquer
// lugar) e extrair nome completo, telefone, CPF e data de nascimento, pra
// não precisar digitar contato por contato dentro do Copiloto.
//
// Reaproveita de propósito o que já existe em panel.js em vez de duplicar:
// `leads` (array em memória, já decifrado quando o painel está
// desbloqueado), `persistLeads()` (cifra e salva — mesmo cofre de sempre),
// `criarLeadBase()`, `maskTelefone`/`maskCpf` (mesma formatação visual do
// resto da ficha) e `renderLeadsList()`/`toast()`. Este arquivo só faz a
// extração de texto e a tela de conferência; a gravação em si passa pelo
// mesmo caminho de sempre, então nada aqui muda como os dados protegidos
// são cifrados em repouso.

(function(){

  // ---------- Regras de reconhecimento ----------

  const RX_CPF_FORMATADO = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
  const RX_CPF_11_DIGITOS = /\b\d{11}\b/;
  const RX_DATA_BR = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})\b/;
  const RX_DATA_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
  // Telefone: aceita +55, parênteses, espaços/traços, com ou sem o 9º dígito.
  const RX_TELEFONE = /(?:\+?55[\s.\-]?)?\(?\d{2}\)?[\s.\-]?9?\d{4}[\s.\-]?\d{4}\b/;

  const RX_LABEL_NOME = /^\s*(?:nome(?:\s+completo)?|cliente|contato)\s*[:\-]\s*(.+)$/i;
  const RX_LABEL_TEL = /(?:telefone|fone|celular|whats(?:app)?|whatsapp)\s*[:\-]\s*([+\d()\s.\-]{8,20})/i;
  const RX_LABEL_CPF = /cpf\s*[:\-]\s*([\d.\-]{11,14})/i;
  const RX_LABEL_DATA = /(?:data\s*de\s*nascimento|nascimento|aniversário|aniversario|nasc\.?)\s*[:\-]\s*([\d\/\-.]{6,10})/i;

  function apenasDig(v){ return (v||'').replace(/\D/g,''); }

  function pareceCpfFormatado(v){ return RX_CPF_FORMATADO.test(v||''); }

  // A guarda de comprimento acima já limita d.length a 10-13 — então
  // "d.length === 10 || ... === 13" no final é sempre verdadeiro e o teste
  // de pontuação (/[()+.\- ]/) nunca influencia o resultado de verdade,
  // apesar do nome sugerir o contrário. Simplificado pra dizer só o que a
  // função realmente decide: comprimento plausível de telefone BR.
  function pareceTelefoneFormatado(v){
    const d = apenasDig(v);
    return d.length >= 10 && d.length <= 13;
  }

  // Converte qualquer formato de data reconhecido pra yyyy-mm-dd (formato
  // que o input type="date" do Copiloto espera — ver leadDataNascimento em
  // panel.html e o campo dataNascimento em criarLeadBase).
  function normalizarDataParaIso(v){
    if(!v) return '';
    const iso = v.match(RX_DATA_ISO);
    if(iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const br = v.match(RX_DATA_BR);
    if(br){
      let [, dia, mes, ano] = br;
      dia = dia.padStart(2,'0'); mes = mes.padStart(2,'0');
      // ">=" (não ">"): com ">", o ano de 2 dígitos "30" caía num buraco —
      // a heurística escolhia "20"+"30"=2030 (30 > 30 é falso), mas o teto
      // de anoNum > 2029 logo abaixo rejeitava 2030 sempre, e a hipótese
      // 1930 nunca chegava a ser tentada. Com ">=", "30" vira 1930 (dentro
      // do teto), igual qualquer outro valor de 30-99.
      if(ano.length === 2) ano = (Number(ano) >= 30 ? '19' : '20') + ano;
      const diaNum = Number(dia), mesNum = Number(mes), anoNum = Number(ano);
      if(mesNum < 1 || mesNum > 12 || diaNum < 1 || diaNum > 31 || anoNum < 1900 || anoNum > 2029) return '';
      return `${ano}-${mes}-${dia}`;
    }
    return '';
  }

  function normalizarNome(v){
    return (v||'')
      .replace(/["'“”]/g,'')
      .replace(/\s+/g,' ')
      .trim();
  }

  function contatoVazio(){ return { nome:'', telefone:'', cpf:'', dataNascimento:'' }; }

  function temAlgumDado(c){ return !!(c.nome || c.telefone || c.cpf || c.dataNascimento); }

  // ---------- Extração "às cegas" (sem rótulos), texto livre ----------

  function extrairDeTextoLivre(textoOriginal){
    const c = contatoVazio();
    let trabalho = textoOriginal;

    // CPF só é aceito "às cegas" quando vem formatado (com pontos e
    // traço) — um número puro de 11 dígitos é ambíguo demais com celular
    // (DDD + 9 dígitos também dá 11), então nesse caso preferimos tratar
    // como telefone e deixar a pessoa corrigir na tabela de conferência.
    const cpfMatch = trabalho.match(RX_CPF_FORMATADO);
    if(cpfMatch){
      c.cpf = cpfMatch[0];
      trabalho = trabalho.replace(cpfMatch[0], ' ');
    }

    const dataMatch = trabalho.match(RX_DATA_ISO) || trabalho.match(RX_DATA_BR);
    if(dataMatch){
      c.dataNascimento = normalizarDataParaIso(dataMatch[0]);
      trabalho = trabalho.replace(dataMatch[0], ' ');
    }

    const telMatch = trabalho.match(RX_TELEFONE) || (!c.cpf ? trabalho.match(RX_CPF_11_DIGITOS) : null);
    if(telMatch){
      c.telefone = telMatch[0];
      trabalho = trabalho.replace(telMatch[0], ' ');
    }

    // O que sobra, limpo de pontuação solta e separadores, vira o nome.
    const nomeCandidato = trabalho
      .split('\n')
      .map(l => l.replace(/^[\s,;|\-–—:]+|[\s,;|\-–—:]+$/g, ''))
      .filter(Boolean)
      .sort((a,b)=> b.replace(/[^a-zA-ZÀ-ÿ]/g,'').length - a.replace(/[^a-zA-ZÀ-ÿ]/g,'').length)[0] || '';
    c.nome = normalizarNome(nomeCandidato);

    return c;
  }

  // ---------- Extração de um bloco (uma ou mais linhas = 1 contato) ----------

  function extrairContatoDeBloco(linhas){
    const c = contatoVazio();
    const linhasRestantes = [];

    for(const linha of linhas){
      const mNome = linha.match(RX_LABEL_NOME);
      if(mNome && !c.nome){ c.nome = normalizarNome(mNome[1]); continue; }
      linhasRestantes.push(linha);
    }

    const textoRestante = linhasRestantes.join('\n');

    const mTel = textoRestante.match(RX_LABEL_TEL);
    if(mTel) c.telefone = mTel[1].trim();

    const mCpf = textoRestante.match(RX_LABEL_CPF);
    if(mCpf) c.cpf = mCpf[1].trim();

    const mData = textoRestante.match(RX_LABEL_DATA);
    if(mData) c.dataNascimento = normalizarDataParaIso(mData[1].trim());

    // Nenhum rótulo achado pra nenhum campo → tenta o modo "às cegas" no
    // bloco inteiro.
    if(!c.nome && !c.telefone && !c.cpf && !c.dataNascimento){
      return extrairDeTextoLivre(linhas.join('\n'));
    }

    // Achou rótulo pra ALGUNS campos, mas não todos → completa o que falta
    // rodando o modo "às cegas" só no texto que sobrou (sem as linhas já
    // usadas por rótulo), sem sobrescrever o que já foi encontrado.
    const faltando = !c.nome || !c.telefone || !c.cpf || !c.dataNascimento;
    if(faltando){
      let restoParaVarrer = textoRestante;
      if(mTel) restoParaVarrer = restoParaVarrer.replace(mTel[0], ' ');
      if(mCpf) restoParaVarrer = restoParaVarrer.replace(mCpf[0], ' ');
      if(mData) restoParaVarrer = restoParaVarrer.replace(mData[0], ' ');
      const extra = extrairDeTextoLivre(restoParaVarrer);
      if(!c.nome) c.nome = extra.nome;
      if(!c.telefone) c.telefone = extra.telefone;
      if(!c.cpf) c.cpf = extra.cpf;
      if(!c.dataNascimento) c.dataNascimento = extra.dataNascimento;
    }

    return c;
  }

  // ---------- Modo planilha (colunas separadas por ; , tab ou |) ----------

  function tentarModoPlanilha(linhasNaoVazias){
    const delimitadores = [';','\t','|',','];
    for(const delim of delimitadores){
      const contagens = linhasNaoVazias.map(l => l.split(delim).length - 1);
      const comDelim = contagens.filter(n => n >= 1).length;
      if(comDelim >= Math.max(2, Math.ceil(linhasNaoVazias.length * 0.7))){
        return montarContatosDePlanilha(linhasNaoVazias, delim);
      }
    }
    return null;
  }

  function montarContatosDePlanilha(linhasNaoVazias, delim){
    let linhas = linhasNaoVazias.map(l => l.split(delim).map(c => c.trim()));

    const primeira = linhas[0];
    const pareceCabecalho = primeira.every(c => !/\d/.test(c)) &&
      primeira.some(c => /nome|cliente/i.test(c)) &&
      primeira.some(c => /telefone|fone|celular|whats/i.test(c) || /cpf/i.test(c) || /nasc/i.test(c));

    let mapaColunas = null;
    if(pareceCabecalho){
      mapaColunas = primeira.map(c => {
        if(/nome|cliente/i.test(c)) return 'nome';
        if(/telefone|fone|celular|whats/i.test(c)) return 'telefone';
        if(/cpf/i.test(c)) return 'cpf';
        if(/nasc|aniversario|aniversário/i.test(c)) return 'dataNascimento';
        return null;
      });
      linhas = linhas.slice(1);
    }

    return linhas.map(colunas => {
      const c = contatoVazio();
      if(mapaColunas){
        colunas.forEach((valor, i) => {
          const campo = mapaColunas[i];
          if(!campo || !valor) return;
          if(campo === 'dataNascimento') c.dataNascimento = normalizarDataParaIso(valor);
          else if(campo === 'nome') c.nome = normalizarNome(valor);
          else c[campo] = valor;
        });
      }else{
        // Sem cabeçalho: classifica cada coluna pelo formato do conteúdo.
        colunas.forEach(valor => {
          if(!valor) return;
          if(!c.cpf && pareceCpfFormatado(valor)){ c.cpf = valor; return; }
          if(!c.dataNascimento && (RX_DATA_ISO.test(valor) || RX_DATA_BR.test(valor))){
            c.dataNascimento = normalizarDataParaIso(valor); return;
          }
          if(!c.telefone && pareceTelefoneFormatado(valor) && !/[a-zA-ZÀ-ÿ]{2,}/.test(valor)){ c.telefone = valor; return; }
          if(!c.nome){ c.nome = normalizarNome(valor); return; }
        });
      }
      return c;
    }).filter(temAlgumDado);
  }

  // ---------- Agrupar em blocos (linhas separadas por linha em branco) ----------

  function agruparBlocos(linhas){
    const blocos = [];
    let atual = [];
    for(const linha of linhas){
      if(linha.trim() === ''){
        if(atual.length){ blocos.push(atual); atual = []; }
      }else{
        atual.push(linha);
      }
    }
    if(atual.length) blocos.push(atual);
    return blocos;
  }

  // ---------- Função principal de extração ----------

  function extrairContatos(textoBruto){
    const texto = (textoBruto || '').replace(/\r\n/g, '\n');
    const linhas = texto.split('\n');
    const linhasNaoVazias = linhas.map(l => l.trim()).filter(Boolean);
    if(!linhasNaoVazias.length) return [];

    const viaPlanilha = tentarModoPlanilha(linhasNaoVazias);
    if(viaPlanilha && viaPlanilha.length) return viaPlanilha;

    const blocos = agruparBlocos(linhas);
    let contatos = blocos.map(extrairContatoDeBloco).filter(temAlgumDado);

    // Só formou 1 bloco (sem linha em branco separando), mas tem várias
    // linhas com telefone/CPF/data reconhecíveis → provavelmente é "um
    // contato por linha" colado sem espaçamento entre eles. Nesse caso,
    // reparte linha a linha em vez de tratar tudo como um contato só.
    if(blocos.length <= 1 && linhasNaoVazias.length > 1){
      const porLinha = linhasNaoVazias.map(l => extrairContatoDeBloco([l])).filter(temAlgumDado);
      const pontuar = (lista) => lista.reduce((s,c)=> s + (c.telefone?1:0) + (c.cpf?1:0), 0);
      if(porLinha.length > 1 && pontuar(porLinha) >= pontuar(contatos)) contatos = porLinha;
    }

    return contatos;
  }

  // ---------- Estado da tela ----------

  let contatosExtraidos = []; // [{id, nome, telefone, cpf, dataNascimento, incluir, statusInfo}]
  let seqId = 0;

  function telefoneBate(a, b){
    const da = apenasDig(a), db = apenasDig(b);
    return !!da && !!db && da.slice(-8) === db.slice(-8);
  }

  function calcularStatus(item){
    if(typeof leads === 'undefined' || !Array.isArray(leads)){
      return { tipo:'novo', leadExistenteId:null, texto:'Novo' };
    }
    if(item.telefone){
      const existente = leads.find(l => telefoneBate(l.telefone, item.telefone));
      if(existente) return { tipo:'existente', leadExistenteId: existente.id, texto:'Já existe no CRM' };
    }
    if(!item.nome && !item.telefone){
      return { tipo:'incompleto', leadExistenteId:null, texto:'Sem nome nem telefone' };
    }
    return { tipo:'novo', leadExistenteId:null, texto:'Novo' };
  }

  function reclassificarTodos(){
    contatosExtraidos.forEach(item => { item.statusInfo = calcularStatus(item); });
  }

  function renderResumoETabela(){
    const wrap = document.getElementById('importarResultadoWrap');
    const resumo = document.getElementById('importarResumo');
    const tbody = document.getElementById('importarTabelaBody');
    const confirmarBtn = document.getElementById('importarConfirmarBtn');

    if(!contatosExtraidos.length){
      wrap.style.display = 'none';
      confirmarBtn.style.display = 'none';
      return;
    }
    wrap.style.display = '';

    const novos = contatosExtraidos.filter(c => c.incluir && c.statusInfo.tipo === 'novo').length;
    const existentes = contatosExtraidos.filter(c => c.incluir && c.statusInfo.tipo === 'existente').length;
    const incompletos = contatosExtraidos.filter(c => c.statusInfo.tipo === 'incompleto').length;
    const selecionados = contatosExtraidos.filter(c => c.incluir).length;

    resumo.innerHTML = `
      <div class="importar-resumo-item"><b>${contatosExtraidos.length}</b>encontrados</div>
      <div class="importar-resumo-item"><b>${novos}</b>novos selecionados</div>
      <div class="importar-resumo-item"><b>${existentes}</b>já existem (serão atualizados só nos campos vazios)</div>
      ${incompletos ? `<div class="importar-resumo-item"><b>${incompletos}</b>sem nome nem telefone</div>` : ''}
    `;

    tbody.innerHTML = contatosExtraidos.map(item => {
      const pillClass = item.statusInfo.tipo === 'novo' ? 'importar-status-novo'
        : item.statusInfo.tipo === 'existente' ? 'importar-status-existente'
        : 'importar-status-incompleto';
      return `
        <tr data-id="${item.id}" class="${!item.incluir ? 'linha-ignorada' : ''}">
          <td><input type="checkbox" class="importar-chk" data-id="${item.id}" ${item.incluir ? 'checked' : ''}></td>
          <td><input type="text" class="importar-campo" data-id="${item.id}" data-campo="nome" value="${escapeHtml(item.nome)}" placeholder="Nome completo"></td>
          <td><input type="text" class="importar-campo" data-id="${item.id}" data-campo="telefone" value="${escapeHtml(item.telefone)}" placeholder="(00) 00000-0000"></td>
          <td><input type="text" class="importar-campo" data-id="${item.id}" data-campo="cpf" value="${escapeHtml(item.cpf)}" placeholder="000.000.000-00"></td>
          <td><input type="date" class="importar-campo" data-id="${item.id}" data-campo="dataNascimento" value="${escapeHtml(item.dataNascimento)}"></td>
          <td><span class="importar-status-pill ${pillClass}">${item.statusInfo.texto}</span></td>
          <td class="importar-col-del"><button class="importar-del-btn" data-id="${item.id}" title="Remover da lista">🗑️</button></td>
        </tr>
      `;
    }).join('');

    document.getElementById('importarConfirmarBtn').style.display = selecionados ? '' : 'none';
    document.getElementById('importarConfirmarBtn').textContent = `Importar ${selecionados} contato${selecionados===1?'':'s'} selecionado${selecionados===1?'':'s'}`;

    const todosMarcados = contatosExtraidos.every(c => c.incluir);
    document.getElementById('importarSelecionarTodos').checked = todosMarcados;
  }

  // escapeHtml (global, definida em panel.js — carregado antes deste
  // arquivo) já cobre isto; não precisa de uma cópia local.

  function limparResultado(){
    contatosExtraidos = [];
    document.getElementById('importarResultadoWrap').style.display = 'none';
    document.getElementById('importarConfirmarBtn').style.display = 'none';
  }

  function extrairEExibir(){
    const texto = document.getElementById('importarTextarea').value;
    if(!texto.trim()){
      if(typeof toast === 'function') toast('Cole ou envie algum texto primeiro');
      return;
    }
    const brutos = extrairContatos(texto);
    contatosExtraidos = brutos.map(c => ({
      id: 'imp_' + (++seqId),
      nome: c.nome || '',
      telefone: c.telefone ? (typeof maskTelefone === 'function' ? maskTelefone(c.telefone) : c.telefone) : '',
      cpf: c.cpf ? (typeof maskCpf === 'function' ? maskCpf(c.cpf) : c.cpf) : '',
      dataNascimento: c.dataNascimento || '',
      incluir: true,
      statusInfo: null
    }));
    reclassificarTodos();
    // Contato sem nenhum dado útil (nem nome nem telefone) já entra
    // desmarcado, pra não atrapalhar a contagem de importação.
    contatosExtraidos.forEach(c => { if(c.statusInfo.tipo === 'incompleto') c.incluir = false; });
    renderResumoETabela();
    if(!contatosExtraidos.length && typeof toast === 'function'){
      toast('Não consegui reconhecer nenhum contato nesse texto. Confira o formato colado.');
    }
  }

  async function confirmarImportacao(){
    const selecionados = contatosExtraidos.filter(c => c.incluir);
    if(!selecionados.length) return;

    if(typeof leads === 'undefined' || typeof persistLeads !== 'function' || typeof criarLeadBase !== 'function'){
      if(typeof toast === 'function') toast('Não foi possível acessar o CRM para importar agora. Recarregue a página e tente de novo.');
      return;
    }

    let criados = 0, atualizados = 0;
    const nowIso = new Date().toISOString();

    for(const item of selecionados){
      // Recalcula contra o array `leads` ATUAL (não o id congelado em
      // item.statusInfo, calculado uma vez antes deste laço começar) — sem
      // isto, dois contatos duplicados dentro do mesmo texto/arquivo colado
      // (mesmo telefone aparecendo duas vezes) criavam DOIS leads pra
      // mesma pessoa: o primeiro é empurrado em `leads` durante a própria
      // iteração deste laço, mas o segundo, calculado com o statusInfo de
      // ANTES da importação começar, ainda "achava" que não existia.
      // Recalcular a cada iteração pega tanto duplicata contra o CRM quanto
      // duplicata dentro da mesma leva.
      const existente = item.telefone
        ? leads.find(l => telefoneBate(l.telefone, item.telefone))
        : (item.statusInfo && item.statusInfo.leadExistenteId
          ? leads.find(l => l.id === item.statusInfo.leadExistenteId)
          : null);

      if(existente){
        // Só completa o que estava vazio — nunca sobrescreve dado que já
        // existia no lead (evita perder informação já curada manualmente).
        if(!existente.nome && item.nome) existente.nome = item.nome;
        if(!existente.cpf && item.cpf) existente.cpf = item.cpf;
        if(!existente.dataNascimento && item.dataNascimento) existente.dataNascimento = item.dataNascimento;
        if(!existente.telefone && item.telefone) existente.telefone = item.telefone;
        atualizados++;
      }else{
        const id = 'lead_' + Date.now() + '_' + (++seqId);
        leads.push(criarLeadBase({
          id,
          nome: item.nome || '',
          telefone: item.telefone || '',
          cpf: item.cpf || '',
          dataNascimento: item.dataNascimento || '',
          criadoEm: nowIso,
          dataLead: nowIso
        }));
        criados++;
      }
    }

    await persistLeads();
    // Importação em lote entra no log como UMA entrada com o total — uma
    // por contato encheria o log de auditoria com centenas de linhas
    // idênticas e enterraria os eventos que importam. Condição cobre
    // `atualizados` também (antes só checava `criados`): uma importação que
    // só COMPLETA campos vazios de leads já existentes (CPF, data de
    // nascimento — dados sensíveis, ver acima) também precisa deixar
    // rastro, mesmo sem criar nenhum lead novo.
    if((criados || atualizados) && typeof copilotoRegistrarEventoLog === 'function'){
      try{
        await copilotoRegistrarEventoLog('leads_importados', await copilotoObterPerfilAtivo(),
          `${criados} lead${criados === 1 ? '' : 's'} criado${criados === 1 ? '' : 's'} e ${atualizados} atualizado${atualizados === 1 ? '' : 's'} de arquivo`);
      }catch(e){}
    }
    if(typeof renderLeadsList === 'function') renderLeadsList();
    if(typeof toast === 'function'){
      toast(`Importação concluída: ${criados} novo(s), ${atualizados} atualizado(s) ✅`);
    }

    fecharModal();
    limparResultado();
    document.getElementById('importarTextarea').value = '';
  }

  function abrirModal(){
    document.getElementById('importarModalOverlay').style.display = 'flex';
  }
  function fecharModal(){
    document.getElementById('importarModalOverlay').style.display = 'none';
  }

  const IMPORTAR_ARQUIVO_TAMANHO_MAX = 5 * 1024 * 1024; // 5MB — texto puro, nenhuma lista de contatos real chega perto disso

  function lerArquivo(file){
    if(file.size > IMPORTAR_ARQUIVO_TAMANHO_MAX){
      if(typeof toast === 'function') toast('Esse arquivo é grande demais (máx. 5MB) — confira se é mesmo uma lista de contatos em texto.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      document.getElementById('importarTextarea').value = reader.result || '';
    };
    reader.onerror = () => {
      if(typeof toast === 'function') toast('Não deu para ler esse arquivo.');
    };
    reader.readAsText(file, 'utf-8');
  }

  function bindImportarEvents(){
    const btnAbrir = document.getElementById('importarContatosBtn');
    if(!btnAbrir) return; // painel ainda não montado (não deveria acontecer, mas evita erro em outras telas)

    btnAbrir.addEventListener('click', abrirModal);
    document.getElementById('importarModalCloseBtn').addEventListener('click', fecharModal);
    document.getElementById('importarCancelarBtn').addEventListener('click', fecharModal);
    document.getElementById('importarModalOverlay').addEventListener('click', (e) => {
      if(e.target.id === 'importarModalOverlay') fecharModal();
    });

    document.getElementById('importarExtrairBtn').addEventListener('click', extrairEExibir);
    document.getElementById('importarLimparBtn').addEventListener('click', () => {
      document.getElementById('importarTextarea').value = '';
      limparResultado();
    });
    document.getElementById('importarArquivoInput').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if(file) lerArquivo(file);
      e.target.value = '';
    });
    document.getElementById('importarConfirmarBtn').addEventListener('click', confirmarImportacao);

    document.getElementById('importarSelecionarTodos').addEventListener('change', (e) => {
      contatosExtraidos.forEach(c => { c.incluir = e.target.checked; });
      renderResumoETabela();
    });

    // Delegação: tabela é recriada a cada render, então os eventos ficam no
    // corpo (tbody) e no wrapper, que nunca são substituídos.
    document.getElementById('importarTabelaBody').addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      if(!id) return;
      const item = contatosExtraidos.find(c => c.id === id);
      if(!item) return;

      if(e.target.classList.contains('importar-chk')){
        item.incluir = e.target.checked;
        renderResumoETabela();
        return;
      }
      if(e.target.classList.contains('importar-campo')){
        const campo = e.target.getAttribute('data-campo');
        item[campo] = e.target.value;
        if(campo === 'telefone') reclassificarTodos();
        renderResumoETabela();
      }
    });

    document.getElementById('importarTabelaBody').addEventListener('click', (e) => {
      const btn = e.target.closest('.importar-del-btn');
      if(!btn) return;
      const id = btn.getAttribute('data-id');
      contatosExtraidos = contatosExtraidos.filter(c => c.id !== id);
      renderResumoETabela();
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bindImportarEvents);
  }else{
    bindImportarEvents();
  }

})();
