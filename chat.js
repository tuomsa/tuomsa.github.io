const messages = document.getElementById('messages');
const input = document.getElementById('message');
const sendBtn = document.getElementById('send');
const newChatBtn = document.getElementById('new-chat');
const historyList = document.getElementById('history-list');

// ← replace with your Cloudflare Worker URL
const WORKER_URL = 'https://frosty-cherry-5715.tuomashiljanen.workers.dev';

const MODEL = 'openrouter/free';

let currentChat = [];
let allChats = JSON.parse(localStorage.getItem('chatHistory') || '[]');

function saveHistory() {
  localStorage.setItem('chatHistory', JSON.stringify(allChats));
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = '';
  if (allChats.length === 0) {
    historyList.innerHTML = '<p style="color:#888;font-size:0.9rem;">No past chats yet</p>';
    return;
  }
  [...allChats].reverse().forEach((chat, i) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const preview = chat[0]?.content?.slice(0, 50) || 'Empty chat';
    div.textContent = preview + (preview.length >= 50 ? '…' : '');
    div.onclick = () => loadChat(allChats.length - 1 - i);
    historyList.appendChild(div);
  });
}

function loadChat(index) {
  currentChat = allChats[index] || [];
  messages.innerHTML = '';
  currentChat.forEach(msg => {
    addMessage(msg.content, msg.role === 'user' ? 'user' : 'bot', false);
  });
}

function addMessage(text, type, save = true) {
  const div = document.createElement('div');
  div.className = `msg ${type}`;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

  if (save) {
    currentChat.push({ role: type === 'user' ? 'user' : 'assistant', content: text });
  }
  return div;
}

async function getReply(userText) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        ...currentChat.slice(-10),
        { role: 'user', content: userText }
      ]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'API error');
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'No reply';
}

async function handleSend() {
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  const thinking = addMessage('Thinking...', 'bot', false);

  try {
    const reply = await getReply(text);
    thinking.textContent = reply;
    currentChat.push({ role: 'assistant', content: reply });

    if (currentChat.length === 2) {
      allChats.push([...currentChat]);
    } else {
      allChats[allChats.length - 1] = [...currentChat];
    }
    saveHistory();
  } catch (err) {
    thinking.textContent = 'Error: ' + (err.message || 'Something went wrong');
    console.error(err);
  }

  input.disabled = false;
  sendBtn.disabled = false;
  input.focus();
}

function startNewChat() {
  currentChat = [];
  messages.innerHTML = '';
  input.value = '';
  input.focus();
}

sendBtn.addEventListener('click', handleSend);
newChatBtn.addEventListener('click', startNewChat);

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

renderHistory();
