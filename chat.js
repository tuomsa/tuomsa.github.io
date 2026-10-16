const messagesEl = document.getElementById('messages');
const input = document.getElementById('message');
const sendBtn = document.getElementById('send');
const newChatBtn = document.getElementById('new-chat');
const clearHistoryBtn = document.getElementById('clear-history');
const historyList = document.getElementById('history-list');
const systemPromptEl = document.getElementById('system-prompt');
const themeToggle = document.getElementById('theme-toggle');
const exportBtn = document.getElementById('export-btn');
const voiceBtn = document.getElementById('voice-btn');
const voiceReplyToggle = document.getElementById('voice-reply-toggle');
const stopTalkingBtn = document.getElementById('stop-talking');
const langToggle = document.getElementById('lang-toggle');

const WORKER_URL = 'https://frosty-cherry-5715.tuomashiljanen.workers.dev';
const MODEL = 'openrouter/free';

let currentChat = [];
let allChats = JSON.parse(localStorage.getItem('chatHistory') || '[]');
let voiceRepliesEnabled = false;
let currentLang = 'fi-FI';

function saveHistory() {
  localStorage.setItem('chatHistory', JSON.stringify(allChats));
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = '';
  if (!allChats.length) {
    historyList.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">No past chats</p>';
    return;
  }
  [...allChats].reverse().forEach((chat, i) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const preview = chat.find(m => m.role === 'user')?.content?.slice(0, 60) || 'Chat';
    div.textContent = preview + (preview.length >= 60 ? '…' : '');
    div.onclick = () => loadChat(allChats.length - 1 - i);
    historyList.appendChild(div);
  });
}

function loadChat(index) {
  currentChat = JSON.parse(JSON.stringify(allChats[index] || []));
  messagesEl.innerHTML = '';
  currentChat.forEach(msg => {
    addMessage(msg.content, msg.role === 'user' ? 'user' : 'bot', false);
  });
}

function addMessage(text, type, save = true) {
  const div = document.createElement('div');
  div.className = `msg ${type}`;
  div.textContent = text;

  if (type === 'bot') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.onclick = () => navigator.clipboard.writeText(text);
    div.appendChild(copyBtn);
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  if (save) {
    currentChat.push({ role: type === 'user' ? 'user' : 'assistant', content: text });
  }
  return div;
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'msg bot';
  div.id = 'typing';
  div.innerHTML = '<span class="typing"></span><span class="typing"></span><span class="typing"></span>';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function speak(text) {
  if (!window.speechSynthesis || !voiceRepliesEnabled) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = currentLang;
  utterance.rate = 1;
  utterance.pitch = 1;
  speechSynthesis.speak(utterance);
}

async function getReplyStream(userText, onChunk) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      messages: [
        { role: 'system', content: systemPromptEl.value || 'You are a helpful assistant.' },
        ...currentChat.slice(-12),
        { role: 'user', content: userText }
      ]
    })
  });

  if (!res.ok) throw new Error(await res.text());

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
    for (const line of lines) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.delta?.content || '';
        if (content) {
          full += content;
          onChunk(full);
        }
      } catch {}
    }
  }
  return full;
}

async function handleSend() {
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  const typing = showTyping();
  let botDiv = null;

  try {
    const reply = await getReplyStream(text, (partial) => {
      if (!botDiv) {
        typing.remove();
        botDiv = addMessage(partial, 'bot', false);
      } else {
        botDiv.childNodes[0].textContent = partial;
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });

    if (botDiv) {
      currentChat.push({ role: 'assistant', content: reply });
      speak(reply);
    }

    if (currentChat.length >= 2) {
      if (allChats.length && allChats[allChats.length - 1].length < currentChat.length) {
        allChats[allChats.length - 1] = [...currentChat];
      } else {
        allChats.push([...currentChat]);
      }
      saveHistory();
    }
  } catch (err) {
    typing.remove();
    addMessage('Error: ' + err.message, 'bot', false);
  }

  input.disabled = false;
  sendBtn.disabled = false;
  input.focus();
}

function startNewChat() {
  currentChat = [];
  messagesEl.innerHTML = '';
  input.focus();
}

function clearAllHistory() {
  if (confirm('Clear all chat history?')) {
    allChats = [];
    localStorage.removeItem('chatHistory');
    renderHistory();
    startNewChat();
  }
}

function exportChat() {
  if (!currentChat.length) return alert('Nothing to export');
  const text = currentChat.map(m => `${m.role === 'user' ? 'You' : 'Bot'}: ${m.content}`).join('\n\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'chat-export.txt';
  a.click();
}

// Voice input
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

function updateVoiceButton() {
  if (!SpeechRecognition) {
    voiceBtn.textContent = 'Voice (not supported)';
    voiceBtn.disabled = true;
    return;
  }
  voiceBtn.disabled = false;
  voiceBtn.textContent = 'Voice';
}

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = currentLang;
  recognition.maxAlternatives = 3;

  voiceBtn.onclick = () => {
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
      return;
    }
    recognition.lang = currentLang;
    try {
      recognition.start();
    } catch (err) {
      alert('Could not start microphone. Allow mic access and use Chrome/Edge on HTTPS.');
    }
  };

  recognition.onstart = () => {
    isListening = true;
    voiceBtn.textContent = 'Stop';
    voiceBtn.style.background = '#ff3b30';
    voiceBtn.style.color = '#fff';
  };

  recognition.onend = () => {
    isListening = false;
    voiceBtn.textContent = 'Voice';
    voiceBtn.style.background = '';
    voiceBtn.style.color = '';
  };

  recognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    input.value = transcript;
  };

  recognition.onerror = (e) => {
    console.log('Speech error:', e.error);
    isListening = false;
    voiceBtn.textContent = 'Voice';
    voiceBtn.style.background = '';
    voiceBtn.style.color = '';
    if (e.error === 'not-allowed') {
      alert('Microphone blocked. On phone: Settings → Site permissions → Microphone → Allow.');
    }
  };
}

updateVoiceButton();

// Language switch
langToggle.onclick = () => {
  if (currentLang === 'fi-FI') {
    currentLang = 'en-US';
    langToggle.textContent = 'Lang: EN';
  } else {
    currentLang = 'fi-FI';
    langToggle.textContent = 'Lang: FI';
  }
  if (recognition) recognition.lang = currentLang;
};

// Voice replies + stop
voiceReplyToggle.onclick = () => {
  voiceRepliesEnabled = !voiceRepliesEnabled;
  voiceReplyToggle.textContent = voiceRepliesEnabled ? 'Voice replies: On' : 'Voice replies: Off';
};

stopTalkingBtn.onclick = () => {
  if (window.speechSynthesis) speechSynthesis.cancel();
};

document.querySelectorAll('.suggestions button').forEach(btn => {
  btn.onclick = () => {
    input.value = btn.dataset.prompt;
    input.focus();
  };
});

themeToggle.onclick = () => {
  document.body.classList.toggle('dark');
  themeToggle.textContent = document.body.classList.contains('dark') ? 'Light' : 'Dark';
};

sendBtn.onclick = handleSend;
newChatBtn.onclick = startNewChat;
clearHistoryBtn.onclick = clearAllHistory;
exportBtn.onclick = exportChat;

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

renderHistory();

// Random dog hero images
const heroImg = document.getElementById('hero-ai');

async function updateHeroImage() {
  try {
    const res = await fetch('https://dog.ceo/api/breeds/image/random');
    const data = await res.json();
    if (data.status === 'success') {
      heroImg.src = data.message;
    }
  } catch (err) {
    console.log('Failed to load dog image', err);
    heroImg.src = `https://picsum.photos/1200/600?random=${Date.now()}`;
  }
}

updateHeroImage();
setInterval(updateHeroImage, 30000);
