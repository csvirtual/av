// UI do chat. Cada pedido do usuário chama a IA (providers.js) passando o
// projeto atual como contexto, recebe de volta a árvore atualizada e entrega
// pra quem estiver ouvindo (app.js) — que atualiza o mesmo estado usado pelo
// editor visual. Um pedido no chat e um arraste no canvas editam a mesma coisa.

function initChat({ messagesEl, inputEl, sendBtn }, { getProject, getSettings, onProjectReady }) {
  function addMessage(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  addMessage('assistant', 'Oi! Descreva o sistema que você quer criar (ex: "um formulário de cadastro de clientes com tabela de listagem") ou peça uma alteração no projeto atual. Você também pode montar tudo na aba Editor Visual, arrastando componentes.');

  async function handleSend() {
    const prompt = inputEl.value.trim();
    if (!prompt) return;
    const settings = await getSettings();
    if (!settings.apiKeys?.[settings.provider]) {
      addMessage('assistant', 'Antes de gerar, configure sua chave de API do provedor escolhido na aba Configurações (é grátis pra começar com Groq ou Gemini).');
      return;
    }
    addMessage('user', prompt);
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;
    const thinking = addMessage('assistant', 'Gerando…');
    try {
      const project = await window.CSB_PROVIDERS.generateProject({
        provider: settings.provider,
        apiKey: settings.apiKeys[settings.provider],
        model: settings.model,
        userPrompt: prompt,
        currentProject: getProject(),
      });
      thinking.textContent = project?.name ? `Pronto! ${describeChange(prompt)}` : 'Pronto!';
      onProjectReady(project, { keepId: true });
    } catch (err) {
      thinking.classList.add('error');
      thinking.textContent = `Não consegui gerar: ${err.message}`;
    } finally {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  function describeChange(prompt) {
    return `Atualizei o projeto com base em: "${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}". Veja no Editor Visual ou no Preview.`;
  }

  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  return { addMessage };
}

window.CSB_CHAT = { initChat };
